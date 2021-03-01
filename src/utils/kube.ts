import os from 'os'
import fs from 'mz/fs'
import path from 'path'
import ignore from 'ignore'
import { S3 } from 'aws-sdk'
import { c as tarc } from 'tar'
import { CoreV1Api, AppsV1Api, KubeConfig, V1Service, V1Deployment } from '@kubernetes/client-node'

export const cluster = {
    async fork({ name, image, command, namespace = 'default' }: { name: string, image: string, command: string[], namespace?: string }) {
        const kc = new KubeConfig()
        kc.loadFromDefault()

        const coreV1 = kc.makeApiClient(CoreV1Api)
        await coreV1.createNamespacedPod(namespace, {
            metadata: { name },
            spec: {
                containers: [{
                    name: 'main',
                    image,
                    command,
                    env: [{
                        name: 'FORK_NAME',
                        value: name
                    }, {
                        name: 'FORK_NAMESPACE',
                        value: namespace
                    }]
                }],
                restartPolicy: 'Never'
            }
        })
    },
    async kill({ name, namespace = 'default' }: { name: string, namespace?: string }) {
        const kc = new KubeConfig()
        kc.loadFromDefault()

        const coreV1 = kc.makeApiClient(CoreV1Api)
        await coreV1.deleteNamespacedPod(name, namespace)
    },
    async remove({ name, namespace = 'default' }: { name: string, namespace?: string }) {
        const kc = new KubeConfig()
        kc.loadFromDefault()

        const appsV1 = kc.makeApiClient(AppsV1Api)
        await appsV1.deleteNamespacedDeployment(name, namespace)

        const coreV1 = kc.makeApiClient(CoreV1Api)
        await coreV1.deleteNamespacedService(name, namespace)
    },
    async deploy({ app, name, image, type, namespace = 'default', replicas = 1 }: {
        app: string
        name: string
        image: string
        type: string
        namespace?: string
        replicas?: number
    }) {
        const kc = new KubeConfig()
        kc.loadFromDefault()

        const appsV1 = kc.makeApiClient(AppsV1Api),
            deployment = {
                metadata: { name, labels: { app } },
                spec: {
                    replicas,
                    selector: {
                        matchLabels: { app }
                    },
                    template: {
                        metadata: { labels: { app } },
                        spec: {
                            containers: [{
                                name: 'main',
                                image,
                                ports: [{ containerPort: 8080 }],
                                env: [{
                                    name: 'DEPLOY_IMAGE',
                                    value: image
                                }, {
                                    name: 'DEPLOY_NAMESPACE',
                                    value: namespace
                                }]
                            }]
                        }
                    }
                }
            } as V1Deployment
        try {
            await appsV1.createNamespacedDeployment(namespace, deployment)
        } catch (err) {
            await appsV1.replaceNamespacedDeployment(name, namespace, deployment)
        }

        const coreV1 = kc.makeApiClient(CoreV1Api),
            service = {
                metadata: { name },
                spec: {
                    selector: { app },
                    type,
                    ports: [{
                        protocol: 'TCP',
                        port: 8080,
                    }]
                }
            } as V1Service
        try {
            await coreV1.readNamespacedService(name, namespace)
            console.warn(`INFO: service ${name} already exists in namespace ${namespace}`)
        } catch (err) {
            await coreV1.createNamespacedService(namespace, service)
        }
    }
}

async function makeDockerFile(base: string, npmConfig?: any) {
    const config = Object.entries(npmConfig || { })
        .map(([key, val]) => `RUN npm config set ${key} ${val}`).join('\n')
    return`
FROM ${base}
WORKDIR /app
${config}
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npx sn build
CMD npx sn start
`
}

export async function compress(cwd: string) {
    const ig = ignore()
    if (fs.existsSync(path.join(cwd, '.gitignore'))) {
        const content = await fs.readFile(path.join(cwd, '.gitignore'), 'utf-8')
        for (const line of content.split('\n').map(line => line.trim()).filter(line => line)) {
            ig.add(line)
        }
    }
    const keep = ig.createFilter(),
        check = (file: string) => !file || keep(file),
        filter = (file: string) => !path.basename(file).startsWith('.') && check(path.relative(cwd, file))
    return tarc({ gzip: true, filter, cwd }, await fs.readdir(cwd))
}

export const kaniko = {
    async build({
        namespace, image, s3Config, npmConfig,
        baseImage = 'node:14',
        kanikoImage = 'gcr.io/kaniko-project/executor:debug',
        cacheRepo = ''
    }: {
        namespace: string
        image: string
        s3Config: S3.Types.ClientConfiguration & { bucket: string, endpoint: string }
        npmConfig?: { },
        baseImage?: string
        kanikoImage?: string
        cacheRepo?: string
    }) {
        const prefix = (image.split('/').pop() || 'no-image').replace(/@/g, '').replace(/\W/g, '-'),
            uid = `${prefix}-${Math.random().toString(16).slice(2, 10)}`,
            kc = new KubeConfig()
        kc.loadFromDefault()

        const s3key = `${uid}.tgz`,
            s3 = new S3(s3Config),
            buffer = await compress(process.cwd())
        await s3.upload({ Bucket: s3Config.bucket, Key: s3key, Body: buffer }).promise()

        const api = kc.makeApiClient(CoreV1Api),
            dockerConfig = path.join(os.homedir(), '.docker', 'config.json')
        await api.createNamespacedConfigMap(namespace, {
            metadata: { name: uid },
            data: {
                dockerConfig: await fs.exists(dockerConfig) ?
                    await fs.readFile(dockerConfig, 'utf8') : '{}',
                dockerFile: await fs.exists('Dockerfile') ?
                    await fs.readFile('Dockerfile', 'utf8') : await makeDockerFile(baseImage, npmConfig),
            }
        })

        await api.createNamespacedPod(namespace, {
            metadata: { name: uid },
            spec: {
                containers: [{
                    name: 'kaniko',
                    image: kanikoImage,
                    args: [
                        `--destination=${image}`,
                        `--context=s3://${s3Config.bucket}/${s3key}`,
                        `--dockerfile=/kaniko/.docker/Dockerfile`,
                    ].concat(cacheRepo ? [
                        `--cache=true`,
                        `--cache-repo=${cacheRepo}`
                    ] : []),
                    volumeMounts: [{
                        name: 'config',
                        mountPath: '/kaniko/.docker'
                    }],
                    env: [{
                        name: 'AWS_ACCESS_KEY_ID',
                        value: s3Config.accessKeyId,
                    }, {
                        name: 'AWS_SECRET_ACCESS_KEY',
                        value: s3Config.secretAccessKey,
                    }, {
                        name: 'AWS_REGION',
                        value: s3Config.region,
                    }, {
                        name: 'S3_ENDPOINT',
                        value: s3Config.endpoint,
                    }, {
                        name: 'S3_FORCE_PATH_STYLE',
                        value: '' + s3Config.s3ForcePathStyle,
                    }]
                }],
                volumes: [{
                    name: 'config',
                    configMap: {
                        name: uid,
                        items: [{
                            key: 'dockerConfig',
                            path: 'config.json'
                        }, {
                            key: 'dockerFile',
                            path: 'Dockerfile'
                        }]
                    }
                }],
                restartPolicy: 'Never'
            }
        })

        let { body: { status } } = await api.readNamespacedPodStatus(uid, namespace)
        while (status && status.phase === 'Pending') {
            await new Promise(resolve => setTimeout(resolve, 1000))
            status = (await api.readNamespacedPodStatus(uid, namespace)).body.status
        }

        await api.deleteNamespacedConfigMap(uid, namespace)
        while (status && status.phase !== 'Succeeded' && status.phase !== 'Failed') {
            await new Promise(resolve => setTimeout(resolve, 1000))
            status = (await api.readNamespacedPodStatus(uid, namespace)).body.status
        }

        await s3.deleteObject({ Bucket: s3Config.bucket, Key: s3key })
        if (status && status.phase !== 'Succeeded') {
            const { body } = await api.readNamespacedPodLog(uid, namespace, 'kaniko')
            await api.deleteNamespacedPod(uid, namespace)
            console.error(body)
            throw Error(`pod ${uid} failed`)
        } else {
            await api.deleteNamespacedPod(uid, namespace)
        }
    }
}

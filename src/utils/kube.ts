import os from 'os'
import fs from 'mz/fs'
import path from 'path'
import ignore from 'ignore'
import S3 from 'aws-sdk/clients/s3'
import { c as tarc } from 'tar'
import { CoreV1Api, AppsV1Api, KubeConfig, V1Service, V1Deployment, V1Pod } from '@kubernetes/client-node'

let cache = null as null | KubeConfig
function getKubeConfig() {
    if (!cache) {
        cache = new KubeConfig()
        cache.loadFromDefault()
    }
    return cache
}

export const cluster = {
    async fork({ name, image, command, namespace, env = { } }: {
        name: string
        image: string
        command: string[]
        namespace: string
        env?: Record<string, string>
    }) {
        const coreV1 = getKubeConfig().makeApiClient(CoreV1Api)
        await coreV1.createNamespacedPod(namespace, {
            metadata: { name },
            spec: {
                containers: [{
                    name: 'main',
                    image,
                    command,
                    env: Object.entries(env).map(([name, value]) => ({ name, value }))
                }],
                restartPolicy: 'Never'
            }
        })
    },
    async kill({ name, namespace = 'default' }: { name: string, namespace?: string }) {
        const coreV1 = getKubeConfig().makeApiClient(CoreV1Api)
        await coreV1.deleteNamespacedPod(name, namespace)
    },
    async remove({ name, namespace = 'default' }: { name: string, namespace?: string }) {
        const kc = getKubeConfig()

        const appsV1 = kc.makeApiClient(AppsV1Api)
        await appsV1.deleteNamespacedDeployment(name, namespace)

        const coreV1 = kc.makeApiClient(CoreV1Api)
        await coreV1.deleteNamespacedService(name, namespace)
    },
    async deployPubsub({ app, name, image, type, port, namespace = 'default', env = { } }: {
        app: string
        name: string
        image: string
        type: string
        port: number
        namespace?: string
        replicas?: number
        env?: Record<string, string>
    }) {
        const kc = getKubeConfig(),
            coreV1 = kc.makeApiClient(CoreV1Api)

        const pod = {
            metadata: { name, labels: { app } },
            spec: {
                containers: [{
                    name: 'main',
                    image,
                    ports: [{ containerPort: port }],
                    env: Object.entries(env).map(([name, value]) => ({ name, value }))
                }]
            }
        } as V1Pod
        try {
            await coreV1.deleteNamespacedPod(name, namespace, undefined, undefined, 0)
        } catch (err) {
            // pass
        }
        await coreV1.createNamespacedPod(namespace, pod)

        const service = {
                metadata: { name },
                spec: {
                    selector: { app },
                    type,
                    ports: [{
                        protocol: 'TCP',
                        port,
                    }]
                }
            } as V1Service
        try {
            await coreV1.deleteNamespacedService(name, namespace, undefined, undefined, 0)
        } catch (err) {
            // pass
        }
        await coreV1.createNamespacedService(namespace, service)
    },
    async deploy({ app, name, image, type, port, namespace = 'default', replicas = 1, env = { } }: {
        app: string
        name: string
        image: string
        type: string
        port: number
        namespace?: string
        replicas?: number
        env?: Record<string, string>
    }) {
        const kc = getKubeConfig()

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
                                ports: [{ containerPort: port }],
                                env: Object.entries(env).map(([name, value]) => ({ name, value }))
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
                        port,
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

export async function makeDockerFile(base: string, npmConfig?: any, workspace?: string) {
    const config = Object.entries(npmConfig || { })
        .map(([key, val]) => `RUN npm config set ${key} ${val}`).join('\n')
    return`
FROM ${base}
WORKDIR /app
${config}
COPY package*.json ./
RUN npm ci
COPY . ./
WORKDIR /app/${workspace}
RUN npm exec sn build
CMD npm exec sn start
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
        cacheRepo = '',
        root = '',
        workspace = ''
    }: {
        namespace: string
        image: string
        s3Config: S3.Types.ClientConfiguration & { bucket: string, endpoint: string }
        npmConfig?: { },
        baseImage?: string
        kanikoImage?: string
        cacheRepo?: string
        root?: string
        workspace?: string
    }) {
        const prefix = (image.split('/').pop() || 'no-image').replace(/@/g, '').replace(/\W/g, '-'),
            uid = `${prefix}-${Math.random().toString(16).slice(2, 10)}`,
            kc = new KubeConfig()
        kc.loadFromDefault()

        const s3key = `${uid}.tgz`,
            s3 = new S3(s3Config),
            buffer = await compress(root || process.cwd())
        await s3.upload({ Bucket: s3Config.bucket, Key: s3key, Body: buffer }).promise()

        const api = kc.makeApiClient(CoreV1Api),
            dockerConfig = path.join(os.homedir(), '.docker', 'config.json')
        async function loadDockerConfig(file: string) {
            const content = JSON.parse(await fs.readFile(file, 'utf8'))
            // clear this to avoid `exec: "docker-credential-desktop": executable file not found in $PATH` Error
            delete content.credsStore
            return JSON.stringify(content)
        }
        await api.createNamespacedConfigMap(namespace, {
            metadata: { name: uid },
            data: {
                dockerConfig: await fs.exists(dockerConfig) ?
                    await loadDockerConfig(dockerConfig) :
                    '{}',
                dockerFile: await fs.exists('Dockerfile') ?
                    await fs.readFile('Dockerfile', 'utf8') :
                    await makeDockerFile(baseImage, npmConfig, workspace),
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

        await s3.deleteObject({ Bucket: s3Config.bucket, Key: s3key }).promise()
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

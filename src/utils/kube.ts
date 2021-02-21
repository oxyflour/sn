import os from 'os'
import fs from 'mz/fs'
import path from 'path'
import ignore from 'ignore'
import { S3 } from 'aws-sdk'
import { c as tarc } from 'tar'
import { CoreV1Api, AppsV1Api, KubeConfig } from '@kubernetes/client-node'

export const cluster = {
    async deploy({ app, name, image, namespace = 'default', replicas = 2 }: {
        app: string
        name: string
        image: string
        namespace?: string
        replicas?: number
    }) {
        const kc = new KubeConfig()
        kc.loadFromDefault()

        const appsV1 = kc.makeApiClient(AppsV1Api)
        await appsV1.createNamespacedDeployment(namespace, {
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
                            ports: [{ containerPort: 8080 }]
                        }]
                    }
                }
            }
        })

        const coreV1 = kc.makeApiClient(CoreV1Api)
        await coreV1.createNamespacedService(namespace, {
            metadata: { name },
            spec: {
                selector: { app },
                ports: [{
                    protocol: 'TCP',
                    port: 8080,
                }]
            }
        })
    }
}

async function makeDockerFile(base: string, npmConfig?: any) {
    const config = Object.entries(npmConfig || { })
        .map(([key, val]) => `RUN npm config set ${key} ${val}`).join('\n')
    return`
FROM ${base}
WORKDIR /app
COPY package*.json ./
${config}
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
        namespace, registry, s3Config, npmConfig,
        baseImage = 'node:14',
        kanikoImage = 'gcr.io/kaniko-project/executor:debug',
        cacheRepo = ''
    }: {
        namespace: string
        registry: string
        s3Config: S3.Types.ClientConfiguration & { bucket: string, endpoint: string }
        npmConfig?: { },
        baseImage?: string
        kanikoImage?: string
        cacheRepo?: string
    }) {
        const { name, version } = require(path.join(process.cwd(), 'package.json')) as { name: string, version: string },
            image = `${registry}/${name.replace(/@/g, '')}:${version}`,
            prefix = `${name}:${version}`.replace(/@/g, '').replace(/\W/g, '-'),
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
        return { image, name }
    }
}

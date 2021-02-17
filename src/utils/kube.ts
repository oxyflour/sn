import os from 'os'
import fs from 'mz/fs'
import path from 'path'
import ignore from 'ignore'
import { S3 } from 'aws-sdk'
import { c as tarc } from 'tar'
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node'

export const cluster = {
    async deploy() {

    }
}

function makeDockerFile(base: string) {
    return`
FROM ${base}
COPY package*.json ./
RUN npm ci
COPY . .
RUN sn build
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
    async build({ namespace, registry, s3config, base, cacheRepo = '' }: {
        namespace: string
        registry: string
        s3config: S3.Types.ClientConfiguration & { bucket: string, endpoint: string }
        base: string
        cacheRepo?: string
    }) {
        const { name, version } = require(path.join(process.cwd(), 'package.json')),
            target = `${registry}/${name.replace(/@/g, '')}:${version}`,
            prefix = `${name}:${version}`.replace(/@/g, '').replace(/\W/g, '-'),
            uid = `${prefix}-${Math.random().toString(16).slice(2, 10)}`,
            kc = new KubeConfig()
        kc.loadFromDefault()

        const s3key = `${prefix}.tgz`,
            s3 = new S3(s3config),
            buffer = await compress(process.cwd())
        await s3.upload({ Bucket: s3config.bucket, Key: s3key, Body: buffer }).promise()

        const api = kc.makeApiClient(CoreV1Api)
        await api.createNamespacedConfigMap(namespace, {
            metadata: { name: uid },
            data: {
                dockerConfig: fs.existsSync(path.join(os.homedir(), '.docker', 'config.json')) ?
                    await fs.readFile(path.join(os.homedir(), '.docker', 'config.json'), 'utf8') : '{}',
                dockerFile: fs.existsSync('Dockerfile') ?
                    await fs.readFile('Dockerfile', 'utf8') : makeDockerFile(base),
            }
        })

        await api.createNamespacedPod(namespace, {
            metadata: { name: uid },
            spec: {
                containers: [{
                    name: 'kaniko',
                    image: 'gcr.io/kaniko-project/executor:debug',
                    args: [
                        `--destination=${target}`,
                        `--context=s3://${s3config.bucket}/${s3key}`,
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
                        value: s3config.accessKeyId,
                    }, {
                        name: 'AWS_SECRET_ACCESS_KEY',
                        value: s3config.secretAccessKey,
                    }, {
                        name: 'AWS_REGION',
                        value: s3config.region,
                    }, {
                        name: 'S3_ENDPOINT',
                        value: s3config.endpoint,
                    }, {
                        name: 'S3_FORCE_PATH_STYLE',
                        value: '' + s3config.s3ForcePathStyle,
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
        while (status && status.phase !== 'Succeed' && status.phase !== 'Failed') {
            await new Promise(resolve => setTimeout(resolve, 1000))
            status = (await api.readNamespacedPodStatus(uid, namespace)).body.status
        }

        //await s3.deleteObject({ Bucket: s3config.bucket, Key: s3key })
        if (status && status.phase !== 'Succeed') {
            const { body } = await api.readNamespacedPodLog(uid, namespace, 'kaniko')
            await api.deleteNamespacedPod(uid, namespace)
            console.error(body)
            throw Error(`pod ${uid} failed`)
        }
        return target
    }
}

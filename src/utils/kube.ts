import os from 'os'
import fs from 'mz/fs'
import path from 'path'
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node'

export const cluster = {
    async deploy() {

    }
}

export const kaniko = {
    async build({ namespace, registry, nodeVersion = '14' }: {
        namespace: string,
        registry: string,
        nodeVersion?: string,
    }) {
        const { name, version } = require(path.join(process.cwd(), 'package.json')),
            target = `${registry}/${name.replace(/@/g, '')}:${version}`,
            prefix = `${name.replace(/@/g, '').replace(/\W/g, '-')}-${Math.random().toString(16).slice(2, 10)}`,
            pod = `${prefix}-build`,
            kc = new KubeConfig()
        kc.loadFromDefault()

        const api = kc.makeApiClient(CoreV1Api)
        await api.createNamespacedConfigMap(namespace, {
            metadata: { name: prefix },
            data: {
                npmrc: await fs.readFile(path.join(os.homedir(), '.npmrc'), 'utf8'),
                dockerConfig: await fs.readFile(path.join(os.homedir(), '.docker', 'config.json'), 'utf8'),
                dockerFile: fs.existsSync('Dockerfile') ?
                    await fs.readFile('Dockerfile', 'utf8') : `
                    FROM node:${nodeVersion}
                    COPY package.json ./
                    COPY package-lock.json ./
                    RUN npm ci
                    COPY . .
                    RUN sn build
                    `,
            }
        })

        await api.createNamespacedPod(namespace, {
            metadata: { name: pod },
            spec: {
                initContainers: [{
                    name: 'get-tgz',
                    image: `node:${nodeVersion}`,
                    command: [
                        'sh', '-c',
                        `cp /etc/npm/npmrc ~/.npmrc && ` +
                        `npm pack ${name}@${version} && ` +
                        `mv *.tgz /share/package.tgz`
                    ],
                    volumeMounts: [{
                        name: 'config',
                        mountPath: '/etc/npm'
                    }, {
                        name: 'share',
                        mountPath: '/share'
                    }],
                }],
                containers: [{
                    name: 'kaniko',
                    image: 'gcr.io/kaniko-project/executor:debug',
                    args: [
                        `--destination=${target}`,
                        `--context=tar:///share/package.tgz`,
                        `--dockerfile=/kaniko/.docker/Dockerfile`,
                    ],
                    volumeMounts: [{
                        name: 'config',
                        mountPath: '/kaniko/.docker'
                    }, {
                        name: 'share',
                        mountPath: '/share'
                    }],
                }],
                volumes: [{
                    name: 'config',
                    configMap: {
                        name: prefix,
                        items: [{
                            key: 'dockerConfig',
                            path: 'config.json'
                        }, {
                            key: 'dockerFile',
                            path: 'Dockerfile'
                        }, {
                            key: 'npmrc',
                            path: 'npmrc'
                        }]
                    }
                }, {
                    name: 'share',
                    emptyDir: { }
                }],
                restartPolicy: 'Never'
            }
        })

        let { body: { status } } = await api.readNamespacedPodStatus(pod, namespace)
        while (status && status.phase === 'Pending') {
            await new Promise(resolve => setTimeout(resolve, 1000))
            status = (await api.readNamespacedPodStatus(pod, namespace)).body.status
        }

        await api.deleteNamespacedConfigMap(prefix, namespace)
        while (status && status.phase !== 'Succeed' && status.phase !== 'Failed') {
            await new Promise(resolve => setTimeout(resolve, 1000))
            status = (await api.readNamespacedPodStatus(pod, namespace)).body.status
        }

        if (status && status.phase !== 'Succeed') {
            const { body } = await api.readNamespacedPodLog(pod, namespace, 'kaniko')
            await api.deleteNamespacedPod(pod, namespace)
            console.error(body)
            throw Error(`pod ${pod} failed`)
        }
        return target
    }
}

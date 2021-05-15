import { hookFunc } from '../utils/common'
import form from './form'

export default <T extends { }>({ url = '', prefix = '', opts = { } }: {
    url?: string
    prefix?: string
    opts?: any
}) => hookFunc({ } as T, (...stack) => {
    const entry = stack.map(item => item.propKey),
        part = entry.slice().reverse().join('/')
    return (...args: any[]) => {
        async function post(url: string, ext: any) {
            const body = new FormData(),
                { json, blobs } = form.stringify({ entry, args, prefix, ...opts, ...ext })
            body.append('json', json)
            for (const blob of blobs) {
                body.append('blobs[]', blob)
            }
            const method = 'POST',
                req = await fetch(url, { method, body })
            return await req.json()
        }

        const then = async (resolve: Function, reject = (err: any) => { throw err }) => {
            try {
                const { err, ret } = await post(`${url}/rpc/${part}`, { })
                if (err) {
                    reject(err)
                } else {
                    resolve(ret)
                }
            } catch (err) {
                reject(err)
            }
        }

        const queue = [] as any[],
            callbacks = [] as Function[]
        let sse = null as null | EventSource
        const next = async () => {
            if (!sse) {
                const evt = Math.random().toString(16).slice(2, 10)
                sse = new EventSource(`${url}/sse/${evt}`)
                sse.onmessage = evt => {
                    const data = JSON.parse(evt.data),
                        func = callbacks.shift()
                    func ? func(data) : queue.push(data)
                    if (data.done && sse) {
                        sse.close()
                        sse.onmessage = null
                    }
                }
                const target = Object.assign(new URL(location.href), { pathname: `/pip/${evt}` }),
                    image = (window as any).SN_DEPLOY_IMAGE,
                    namespace = (window as any).SN_DEPLOY_NAMESPACE,
                    kube = image && namespace && { image, namespace }
                post(`${url}/rpc/${part}`, { evt, start: { url: target.toString(), kube } })
            }
            const data = queue.unshift() || await new Promise(func => callbacks.push(func)) as any
            if (data.err) {
                throw Object.assign(new Error(), data.err)
            }
            return data
        }

        return { then, [Symbol.asyncIterator]: () => ({ next }) }
    }
})

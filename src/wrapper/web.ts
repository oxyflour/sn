import { Buffer } from 'buffer'
import { hookFunc } from '../utils/common'
import form from './form'

export default <T extends { }>({ url = '', prefix = '', opts = { } }: {
    url?: string
    prefix?: string
    opts?: any
}) => hookFunc({ } as T, (...stack) => {
    const entry = stack.map(item => item.propKey).reverse(),
        part = entry.slice().join('/')
    return (...args: any[]) => {
        async function post(url: string, ext: any) {
            const { meta, blobs } = form.encode({ entry, args, prefix, ...opts, ...ext }),
                options = { method: 'POST', body: '' as any, headers: { } as any }
            if (blobs.length) {
                const body = options.body = new FormData()
                body.append('meta', JSON.stringify(meta))
                for (const [idx, blob] of blobs.entries()) {
                    blob instanceof File ?
                        body.append('blobs[]', blob) :
                        body.append('blobs[]', blob, '__blob_' + idx)
                }
            } else {
                options.body = JSON.stringify(meta)
                options.headers['Content-Type'] = 'application/json'
            }
            const req = await fetch(url, options)
            if (req.headers.get('Content-Type')?.startsWith('application/json')) {
                const { err, meta, blobs } = await req.json()
                if (err) {
                    throw Object.assign(new Error(), err)
                } else {
                    return form.decode({ meta, blobs: blobs.map((blob: any) => Buffer.from(blob)) })
                }
            } else {
                return Buffer.from(await req.arrayBuffer())
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
                const target = Object.assign(new URL(location.href), { pathname: `/pip/${evt}` })
                await post(`${url}/rpc/${part}`, { evt, url: target.toString() })
            }
            const data = queue.unshift() || await new Promise(func => callbacks.push(func)) as any
            if (data.err) {
                throw Object.assign(new Error(), data.err)
            }
            return data
        }

        return {
            then: (resolve: any, reject: any) =>
                post(`${url}/rpc/${part}`, { }).then(resolve, reject),
            [Symbol.asyncIterator]: () => ({ next })
        }
    }
})

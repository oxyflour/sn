import { hookFunc } from '../utils/common'

export default <T extends { }>({ url = '/rpc' }: {
    url?: string
}) => hookFunc({ } as T, (...stack) => {
    const entry = stack.map(item => item.propKey),
        part = entry.slice().reverse().join('/')
    return (...args: any[]) => {
        async function post(ext: any) {
            const body = JSON.stringify({ entry, args, ...ext }),
                method = 'POST',
                headers = { Accept: 'application/json', 'Content-Type': 'application/json' },
                req = await fetch(`${url}/${part}`, { headers, method, body })
            return await req.json()
        }

        const then = async (resolve: Function, reject: Function) => {
            try {
                const { err, ret } = await post({ })
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
                sse = new EventSource(`/sse/${evt}`)
                sse.onmessage = evt => {
                    const data = JSON.parse(evt.data),
                        func = callbacks.shift()
                    func ? func(data) : queue.push(data)
                    if (data.done && sse) {
                        sse.close()
                        sse.onmessage = null
                    }
                }
                post({ evt })
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

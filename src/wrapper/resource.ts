import { hookFunc } from "../utils/common"

type AsyncFunc = (...args: any[]) => Promise<any>
type UnwarpPromise<T> = T extends Promise<infer P> ? P : T
type UnwarpFunc<F extends (...args: any) => Promise<any>> = (...a: Parameters<F>) => UnwarpPromise<ReturnType<F>>

export type Api = { [key: string]: AsyncFunc | Api }
type UnwarpApi<T extends Api> = {
    [K in keyof T]:
        T[K] extends AsyncFunc ? UnwarpFunc<T[K]> :
        T[K] extends Api ? UnwarpApi<T[K]> :
        unknown
}

export type Status = {
    pending?: Promise<any> | null
    error?: any
    result?: any
}

export default function resource<T extends Api>(api: T) {
    const cache = { } as Record<string, { args: any[], status: Status }[]>
    function getStatus(func: any, key: string, args: any[]) {
        const list = cache[key] || (cache[key] = []),
            found = list.find(item =>
                item.args.length === args.length &&
                item.args.every((arg, idx) => arg === args[idx]))
        if (!found) {
            const status = { } as Status
            status.pending = (async () => {
                try {
                    status.result = await func(...args)
                } catch (error) {
                    status.error = error
                }
                status.pending = null
            })()
            list.push({ args, status })
            return status
        } else {
            return found.status
        }
    }
    return hookFunc({ }, (...stack) => {
        const keys = stack.reverse().map(item => item.propKey),
            func = keys.reduce((ret, key) => ret && ret[key], api as any) as AsyncFunc,
            key = keys.join('.')
        if (!func) {
            throw Error(`${key} is empty or null`)
        }
        return (...args: any[]) => {
            const status = getStatus(func, key, args),
                { pending, error, result } = status
            if (pending) {
                throw pending
            } else if (error) {
                throw error
            } else {
                return result
            }
        }
    }) as UnwarpApi<T>
}

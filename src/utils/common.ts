export type AsyncFunction<T> = (...args: any[]) => Promise<T>
export type AsyncIteratorFunction<T> = (...args: any[]) => AsyncIterableIterator<T>
export interface ApiDefinition { [name: string]: string | AsyncIteratorFunction<any> | AsyncFunction<any> | ApiDefinition }

export interface ProxyStackItem {
    target: any,
    propKey: any,
    receiver: any,
}

export function hookFunc<M extends ApiDefinition>(
        methods: M,
        proxy: (...stack: ProxyStackItem[]) => any,
        stack = [ ] as ProxyStackItem[]): M {
    return new Proxy(methods, {
        get(target, propKey, receiver) {
            const next = [{ target, propKey, receiver }].concat(stack)
            return hookFunc(proxy(...next) as ApiDefinition, proxy, next)
        }
    })
}

export function wrapFunc<M extends ApiDefinition>(
        receiver: M,
        callback: (...stack: ProxyStackItem[]) => void,
        stack = [ ] as ProxyStackItem[]) {
    if (typeof receiver === 'function') {
        return callback(...stack)
    } else if (typeof receiver === 'string') {
        return receiver
    } else {
        const ret = { } as any
        for (const propKey in receiver) {
            const target = receiver[propKey],
                next = [{ target, propKey, receiver }].concat(stack)
            ret[propKey] = wrapFunc(target as ApiDefinition, callback, next)
        }
        return ret
    }
}

export function debounce<F extends Function>(fn: F, delay: number) {
    let timeout = 0
    return ((...args: any[]) => {
        if (timeout) {
            clearTimeout(timeout)
        }
        setTimeout(() => {
            fn(...args)
            timeout = 0
        }, delay)
    }) as any as F
}

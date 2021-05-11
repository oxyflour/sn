export function clone(obj: any, map: (obj: any) => any): any {
    const mapped = map(obj)
    if (mapped !== obj) {
        return mapped
    } else if (Array.isArray(obj)) {
        return obj.map(val => clone(val, map))
    } else if (typeof obj === 'object') {
        return Object.fromEntries(Object.entries(obj).map(([key, val]) => [key, clone(val, map)]))
    } else {
        return map(obj)
    }
}

export function stringify(obj: any) {
    const blobs = [] as (Blob | File)[],
        map = (obj: any) => obj instanceof Blob || obj instanceof globalThis.File ?
            (blobs.push(obj), { __buf: blobs.length - 1 }) : obj,
        json = JSON.stringify(clone(obj, map))
    return { json, blobs }
}

export function parse({ json, blobs }: { json: string, blobs: any[] }) {
    const map = (obj: any) => obj && obj.__buf !== undefined ? blobs[obj.__buf] : obj
    return clone(JSON.parse(json), map)
}

export default { stringify, parse }

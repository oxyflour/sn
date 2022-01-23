import { Buffer } from "buffer"
const { File } = globalThis

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

export function encode(obj: any) {
    const blobs = [] as any[],
        map = (obj: any) =>
            (File && obj instanceof File) ||
            (obj instanceof Buffer) ?
                (blobs.push(obj), { __buf: blobs.length - 1 }) :
            obj instanceof Date ?
                { __date: obj.toString() } :
                obj,
        meta = clone(obj, map)
    return { meta, blobs }
}

export function decode({ meta, blobs }: { meta: any, blobs: any[] }) {
    const map = (obj: any) =>
        obj?.__buf !== undefined ?
            blobs[obj.__buf] :
        obj?.__date ?
            new Date(obj.__date) :
            obj
    return clone(meta, map)
}

export default { encode, decode }

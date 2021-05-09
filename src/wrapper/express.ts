import { Request, Response } from 'express'
import Emitter from '../utils/emitter'

export default async (req: Request, res: Response, modules: { [prefix: string]: { mod: any } }, emitter: Emitter) => {
    const { entry, args, evt, prefix } = req.body as { entry: string[], args: any[], evt: string, prefix: string },
        mod = modules[prefix]?.mod,
        [func, obj] = entry.reduce(([api], key) => [api && (api as any)[key], api], [mod, null]) as any
    if (evt) {
        try {
            for await (const value of func.apply(obj, args)) {
                emitter.emit(evt, { value })
            }
        } catch (err) {
            const { message, name } = err || { }
            emitter.emit(evt, { err: { ...err, message, name } })
        }
        emitter.emit(evt, { done: true })
    } else {
        try {
            const ret = await func.apply(obj, args)
            res.send({ ret })
        } catch (err) {
            const { message, name } = err || { }
            res.send({ err: { ...err, message, name } })
        }
    }
}

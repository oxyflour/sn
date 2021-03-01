import { EventEmitter } from 'events'
import { Request, Response } from 'express'
import { ApiDefinition } from '../utils/common'

export default async <T extends ApiDefinition>(req: Request, res: Response, api: T, emitter: EventEmitter) => {
    const { entry, args, evt } = req.body as { entry: string[], args: any[], evt: string },
        obj = entry.reduce((api, key) => (api as any)[key], api) as any
    if (evt) {
        try {
            for await (const value of obj(...args)) {
                emitter.emit(evt, { value })
            }
        } catch (err) {
            const { message, name } = err || { }
            emitter.emit(evt, { err: { ...err, message, name } })
        }
        emitter.emit(evt, { done: true })
    } else {
        try {
            const ret = await obj(...args)
            res.send({ ret })
        } catch (err) {
            const { message, name } = err || { }
            res.send({ err: { ...err, message, name } })
        }
    }
}

import { Request, Response } from 'express'
import Emitter from '../utils/emitter'
import * as getArgumentNames from 'function-arguments'

export type Context = { func: Function, obj: any, args: any[], req: Request }
export type Middleware = (ctx: Context, next: Function) => any

async function callWithMiddlewares(ctx: Context, [first, ...rest]: Middleware[], thenable: boolean) {
    if (first) {
        return await first(ctx, () => callWithMiddlewares(ctx, rest, thenable))
    } else {
        const res = ctx.func.apply(ctx.obj, ctx.args)
        return thenable ? await res : res
    }
}

export default async (req: Request, res: Response,
        modules: { [prefix: string]: { mod: any } }, emitter: Emitter, middlewares: Middleware[]) => {
    const { entry, args, evt, prefix } = req.body as { entry: string[], args: any[], evt: string, prefix: string },
        mod = modules[prefix]?.mod,
        [func, obj] = entry.reduce(([api], key) => [api && (api as any)[key], api], [mod, null]) as any,
        ctx = { func, obj, args, req },
        argNames = func && (func.__argnames || (func.__argnames = getArgumentNames(func))) || []
    for (const [idx, name] of argNames) {
        if (name === '$ctx') {
            ctx.args[idx] = ctx
        }
    }
    if (evt) {
        try {
            for await (const value of await callWithMiddlewares(ctx, middlewares, false)) {
                emitter.emit(evt, { value })
            }
        } catch (err) {
            const { message, name } = err || { }
            emitter.emit(evt, { err: { ...err, message, name } })
        }
        emitter.emit(evt, { done: true })
    } else {
        try {
            const ret = await callWithMiddlewares(ctx, middlewares, true)
            res.send({ ret })
        } catch (err) {
            const { message, name } = err || { }
            res.send({ err: { ...err, message, name } })
        }
    }
}

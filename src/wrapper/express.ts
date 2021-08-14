import getArgumentNames from 'function-arguments'
import { Request, Response } from 'express'

import Emitter from '../utils/emitter'
import form from './form'
import { cluster } from '../utils/kube'

export type Context = { func: Function, obj: any, args: any[], req?: Request, emitter: Emitter }
export type Middleware = (ctx: Context, next: Function) => any

async function callWithMiddlewares(ctx: Context, [first, ...rest]: Middleware[], thenable: boolean) {
    if (first) {
        return await first(ctx, () => callWithMiddlewares(ctx, rest, thenable))
    } else {
        const res = ctx.func.apply(ctx.obj, ctx.args)
        return thenable ? await res : res
    }
}

function fileWrapper(file: Express.Multer.File) {
    return {
        name: file.originalname,
        size: file.size,
        arrayBuffer: () => Promise.resolve(file.buffer),
    }
}

async function startLocal(emitter: Emitter, evt: string, iter: any) {
    try {
        for await (const value of iter) {
            emitter.emit(evt, { value })
        }
    } catch (err) {
        const { message, name } = err || { }
        emitter.emit(evt, { err: { ...err, message, name } })
    }
    emitter.emit(evt, { done: true })
}

async function forkRemote(emitter: Emitter, evt: string,
        req: Request, namespace: string, image: string) {
    const res = Math.random().toString(16).slice(2, 10),
        name = 'pip-' + evt,
        command = ['node', 'node_modules/.bin/sn', 'pip', res],
        env = { SN_DEPLOY_PUBSUB: process.env.SN_DEPLOY_PUBSUB || '' }
    await cluster.fork({ name, namespace, image, command, env })
    await emitter.next(res)
    const json = req.body.json,
        blobs = Object.values(req.files || []).map(file => ({ ...file }))
    emitter.emit(res, [json, ...blobs])
    return await emitter.next(res)
}

function makeContext(json: string, files: any[], emitter: Emitter,
        modules: { [prefix: string]: { mod: any } }, req?: Request) {
    const blobs = Object.values(files || []).map(fileWrapper),
        { entry, args, evt, prefix } = form.parse({ json, blobs }) as { entry: string[], args: any[], evt: string, prefix: string },
        mod = modules[prefix]?.mod,
        [func, obj] = entry.reduce(([api], key) => [api && (api as any)[key], api], [mod, null]) as any,
        ctx = { func, obj, args, req, emitter, evt },
        argNames = func && (func.__argnames || (func.__argnames = getArgumentNames(func))) || []
    for (const [idx, name] of argNames.entries()) {
        if (name === '$ctx') {
            ctx.args[idx] = ctx
        }
    }
    return ctx
}

export async function pip(res: string, emitter: Emitter,
        modules: { [prefix: string]: { mod: any } }, middlewares: Middleware[]) {
    emitter.emit(res, { })
    try {
        const [json, ...files] = await emitter.next(res) as any[],
            ctx = makeContext(json, files, emitter, modules, { } as any),
            { evt } = ctx
        startLocal(emitter, evt, await callWithMiddlewares(ctx, middlewares, false))
        emitter.emit(res, { ret: { } })
    } catch (err) {
        const { message, name } = err || { }
        emitter.emit(res, { err: { ...err, message, name } })
    }
}

export async function rpc(req: Request, res: Response, emitter: Emitter,
        modules: { [prefix: string]: { mod: any } }, middlewares: Middleware[]) {
    try {
        const json = req.body.json,
            files = Object.values(req.files) || [],
            ctx = makeContext(json, files, emitter, modules, req),
            { evt } = ctx
        if (evt) {
            if (process.env.SN_USE_REMOTE_FORK) {
                const { namespace, image } = JSON.parse(process.env.SN_DEPLOY_OPTIONS || '{}'),
                    ret = await forkRemote(emitter, evt, req, namespace, image)
                res.send({ evt, ret })
            } else {
                startLocal(emitter, evt, await callWithMiddlewares(ctx, middlewares, false))
                res.send({ evt, ret: { } })
            }
        } else {
            const ret = await callWithMiddlewares(ctx, middlewares, true)
            res.send({ ret })
        }
    } catch (err) {
        const { message, name } = err || { }
        res.send({ err: { ...err, message, name } })
    }
}

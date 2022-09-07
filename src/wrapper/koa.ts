import getArgumentNames from 'function-arguments'
import multer from '@koa/multer'
import { IncomingMessage, ServerResponse } from 'http'
import { Context as KoaContext } from 'koa'

import Emitter from '../utils/emitter'
import form from './form'
import { cluster } from '../utils/kube'

export type Context = { func: Function, obj: any, args: any[], req?: IncomingMessage, res?: ServerResponse, emitter: Emitter }
export type Middleware = (ctx: Context, next: Function) => any

async function callWithMiddlewares(ctx: Context, [first, ...rest]: Middleware[], thenable: boolean) {
    if (first) {
        return await first(ctx, () => callWithMiddlewares(ctx, rest, thenable))
    } else {
        const res = ctx.func.apply(ctx.obj, ctx.args)
        return thenable ? await res : res
    }
}

function makeBuffer(file: multer.File) {
    return file.originalname.startsWith('__blob_') ?
        file.buffer : {
            name: file.originalname,
            size: file.size,
            arrayBuffer: () => Promise.resolve(file.buffer.buffer),
        }
}

async function startLocal(emitter: Emitter, evt: string, iter: any) {
    try {
        for await (const value of iter) {
            emitter.emit(evt, { value })
        }
    } catch (err: any) {
        const { message, name } = err || { }
        emitter.emit(evt, { err: { ...err, message, name } })
    }
    emitter.emit(evt, { done: true })
}

async function forkRemote(emitter: Emitter, evt: string,
        koa: KoaContext, namespace: string, image: string) {
    const res = Math.random().toString(16).slice(2, 10),
        name = 'pip-' + evt,
        command = ['node', 'node_modules/.bin/sn', 'pip', res],
        env = { SN_DEPLOY_PUBSUB: process.env.SN_DEPLOY_PUBSUB || '' }
    await cluster.fork({ name, namespace, image, command, env })
    await emitter.next(res)
    const meta = (koa.body as any).meta,
        blobs = Object.values(koa.files || []).map(file => ({ ...file }))
    emitter.emit(res, [meta, ...blobs])
    return await emitter.next(res)
}

function makeContext(meta: any, files: any[], emitter: Emitter,
        modules: { [prefix: string]: { mod: any } }, req?: IncomingMessage, res?: ServerResponse) {
    const blobs = Object.values(files).map(makeBuffer),
        { entry, args, evt, prefix } = form.decode({ meta, blobs }) as { entry: string[], args: any[], evt: string, prefix: string },
        mod = modules[prefix]?.mod,
        [func, obj] = entry.reduce(([api], key) => [api && (api as any)[key], api], [mod, null]) as any,
        ctx = { func, obj, args, req, res, emitter, evt },
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
        const [meta, ...files] = await emitter.next(res) as any[],
            ctx = makeContext(meta, files, emitter, modules, { } as any),
            { evt } = ctx
        startLocal(emitter, evt, await callWithMiddlewares(ctx, middlewares, false))
        emitter.emit(res, { ret: { } })
    } catch (err: any) {
        const { message, name, stack } = err || { }
        emitter.emit(res, { err: { ...err, message, name, stack } })
    }
}

export async function rpc(koa: KoaContext, emitter: Emitter,
        modules: { [prefix: string]: { mod: any } }, middlewares: Middleware[]) {
    try {
        const meta = koa.req.headers['content-type'] === 'application/json' ?
                koa.request.body : JSON.parse(koa.request.body.meta),
            files = Object.values(koa.files || { }),
            ctx = makeContext(meta, files, emitter, modules, koa.req, koa.res),
            { evt } = ctx
        if (evt) {
            if (process.env.SN_USE_REMOTE_FORK) {
                const { namespace, image } = JSON.parse(process.env.SN_DEPLOY_OPTIONS || '{}'),
                    ret = await forkRemote(emitter, evt, koa, namespace, image)
                koa.body = { evt, ret }
            } else {
                startLocal(emitter, evt, await callWithMiddlewares(ctx, middlewares, false))
                koa.body = { evt, ret: { } }
            }
        } else {
            const { meta, blobs } = form.encode(await callWithMiddlewares(ctx, middlewares, true))
            if (blobs.length === 1 && meta.__buf === 0) {
                koa.res.setHeader('Content-Type', 'application/octet-stream')
                koa.body = Buffer.from(blobs[0])
            } else {
                koa.body = { meta, blobs: blobs.map(blob => Array.from(blob)) }
            }
        }
    } catch (err: any) {
        const { message, name, stack } = err || { }
        koa.body = { err: { ...err, message, name, stack } }
    }
}

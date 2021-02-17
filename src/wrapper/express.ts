import { Request, Response } from 'express'
import { ApiDefinition } from '../utils/common'

export default <T extends ApiDefinition>(req: Request, res: Response, api: T) => {
    const { entry, args } = req.body as { entry: string[], args: any[] },
        obj = entry.reduce((api, key) => (api as any)[key], api) as any
    obj(...args)
        .then((ret: any) => {
            res.send({ ret })
        })
        .catch((err: any) => {
            const { message, name } = err || { }
            res.send({ err: { ...err, message, name } })
        })
}

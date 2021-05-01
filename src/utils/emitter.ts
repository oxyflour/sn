import { EventEmitter } from 'events'

export default class Emitter {
    data = { } as { [key: string]: any }
    event = new EventEmitter()
    async set(key: string, val: any) {
        this.data[key] = val
    }
    async get(key: string) {
        return this.data[key]
    }
    async del(key: string) {
        delete this.data[key]
    }
    on(evt: string, cb: (data: any) => any) {
        this.event.on(evt, cb)
    }
    off(evt: string, cb: (data: any) => any) {
        this.event.off(evt, cb)
    }
    once(evt: string, cb: (data: any) => any) {
        const that = this
        this.event.on(evt, function wrapper(data) {
            cb(data)
            that.event.off(evt, wrapper)
        })
    }
    emit(evt: string, data: any) {
        this.event.emit(evt, data)
    }
}

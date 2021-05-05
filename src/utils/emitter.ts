import { EventEmitter } from 'events'

export default class Emitter {
    event = new EventEmitter()
    on(evt: string, cb: (data: any) => any) {
        this.event.on(evt, cb)
    }
    off(evt: string, cb: (data: any) => any) {
        this.event.off(evt, cb)
    }
    emit(evt: string, data: any) {
        this.event.emit(evt, data)
    }
    next(evt: string) {
        const that = this
        return new Promise(resolve => {
            this.event.on(evt, function wrapper(data) {
                resolve(data)
                that.event.off(evt, wrapper)
            })
        })
    }
}

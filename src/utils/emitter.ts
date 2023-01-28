import io from 'socket.io-client'

export default class Emitter {
    ws = null as null | SocketIOClient.Socket
    callbacks = { } as { [evt: string]: Function[] }
    cbs(evt: string) {
        return this.callbacks[evt] || (this.callbacks[evt] = [])
    }
    constructor(url = '') {
        if (url.startsWith('ws://') || url.startsWith('wss://')) {
            this.ws = io(url)
        } else if (url.startsWith('redis://')) {
            // TODO
        }
    }
    on(evt: string, cb: (data: any) => any) {
        if (this.ws) {
            this.ws.on(evt, cb)
            if (!this.cbs(evt).length) {
                this.ws.emit('join', evt)
            }
        }
        this.cbs(evt).push(cb)
    }
    off(evt: string, cb: (data: any) => any) {
        this.callbacks[evt] = this.cbs(evt).filter(fn => fn !== cb)
        if (this.ws) {
            this.ws.off(evt, cb)
            if (!this.cbs(evt).length) {
                this.ws.emit('leave', evt)
            }
        }
    }
    emit(evt: string, data: any) {
        if (this.ws) {
            this.ws.emit('emit', evt, data)
        } else {
            this.cbs(evt).forEach(cb => cb(data))
        }
    }
    next(evt: string) {
        const that = this
        return new Promise(resolve => {
            this.on(evt, function wrapper(data) {
                resolve(data)
                that.off(evt, wrapper)
            })
        })
    }
}

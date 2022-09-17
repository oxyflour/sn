export default {
    async hello(name?: string) {
        // throw Error('x')
        return Buffer.from('world from a ' + name)
    },
    async upload(file: File) {
        console.log(await file.arrayBuffer())
    },
    async *stream() {
        for (let i = 0; i < 10; i ++) {
            yield i
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }
}

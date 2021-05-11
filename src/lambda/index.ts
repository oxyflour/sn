export default {
    async hello() {
        return 'world'
    },
    async upload(file: File) {
        console.log(await file.arrayBuffer())
    },
    async *stream() {
        for (let i = 0; i < 10; i ++) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            yield i
        }
    }
}

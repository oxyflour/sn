export default {
    async hello() {
        return 'world'
    },
    async *stream() {
        for (let i = 0; i < 10; i ++) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            yield i
        }
    }
}

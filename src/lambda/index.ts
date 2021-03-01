import it from './test'

export default {
    async hello() {
        return 'world ' + it()
    },
    async *stream() {
        for (let i = 0; i < 10; i ++) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            if (i === 3) {
                throw Error('boom')
            }
            yield i
        }
        yield -1
    }
}

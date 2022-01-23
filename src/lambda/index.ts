export default {
    async hello(name?: string) {
        return 'world from ' + name
    },
    async upload(file: File) {
        console.log(await file.arrayBuffer())
    },
}

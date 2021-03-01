import { S3 } from 'aws-sdk'

export default class Store {
    constructor(private options: any) {
    }
    s3 = null as null | S3
    inst() {
        return this.s3 || (this.s3 = new S3(this.options))
    }
    async get(key: string) {
        const { Body = '{}' } = await this.inst().getObject({ Bucket: this.options.bucket, Key: key }).promise()
        return JSON.parse(Body.toString())
    }
    async set(key: string, val: any) {
        await this.inst().upload({ Bucket: this.options.bucket, Key: key, Body: Buffer.from(JSON.stringify(val)) }).promise()
    }
    async del(key: string) {
        await this.inst().deleteObject({ Bucket: this.options.bucket, Key: key }).promise()
    }
}

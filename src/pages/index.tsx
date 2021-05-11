import React, { useEffect, useState } from 'react'

import lambda from '../lambda'

export default function App() {
    const [message, setMessage] = useState('...')
    async function init() {
        setMessage(await lambda.hello())
    }
    useEffect(() => { init() }, [])
    async function upload(evt: React.ChangeEvent) {
        await lambda.upload((evt.target as any).files[0])
    }
    return <div>hello { message }!<input type="file" onChange={ upload }></input> </div>
}

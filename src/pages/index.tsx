import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import lambda from '../lambda'

export default function App() {
    const [message, setMessage] = useState('...'),
        [counter, setCounter] = useState(0)
    async function init() {
        setMessage(await lambda.hello())
        for await (const counter of lambda.stream()) {
            setCounter(counter)
        }
    }
    useEffect(() => { init() }, [])
    async function upload(evt: React.ChangeEvent) {
        await lambda.upload((evt.target as any).files[0])
    }
    return <div>
        hello { message }!<input type="file" onChange={ upload }></input>
        <br />
        { counter }
        <br />
        <Link to="a">a</Link>
        <br />
        <Link to="b">b</Link>
    </div>
}

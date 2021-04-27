import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import lambda from '../lambda'

export default function App() {
    const [message, setMessage] = useState('...')
    async function init() {
        setMessage(await lambda.hello())
        for await (const value of lambda.stream()) {
            console.log(value)
        }
    }
    useEffect(() => { init() }, [])
    return <div>
        hell0 { message }
        <br />
        <Link to="/item/0">items 0</Link>
    </div>
}

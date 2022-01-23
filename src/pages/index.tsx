import React, { Suspense } from 'react'

import lambda from '../lambda'
import resource from '../wrapper/resource'

const res = resource(lambda)
function Body() {
    const message = res.hello('Kokomi')
    return <span>hello { message }</span>
}

export default function App() {
    return <Suspense fallback={ '...' }>
        <Body />
    </Suspense>
}

new EventSource('/sse').addEventListener('message', evt => {
    const data = JSON.parse(evt.data)
    if (data.reload) {
        location.reload()
    }
})

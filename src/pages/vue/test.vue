<template>
  <div>
    <h2 class="red">{{msg}}</h2>
    <Link to="/">Go to Foo</Link>
  </div>
</template>

<script>
export default {
  data () {
    return {
      msg: 'Hello from Component A!'
    }
  }
}
</script>

<style>
h2.red {
  color: #f00;
}
</style>

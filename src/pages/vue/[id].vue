<template>
  <div>
    <h2 class="red">{{msg}}</h2>
    <Link to="/">Go to Foo</Link>
  </div>
</template>

<script>
export default {
  props: ['match'],
  data () {
    return {
      msg: `Hello from Component ${this.$props.match.params.id}!`
    }
  }
}
</script>

<style>
h2.red {
  color: #f00;
}
</style>

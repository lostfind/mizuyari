<script lang="ts">
  import Logo from "../components/Logo.svelte";
</script>

<div class="login">
  <div class="card box">
    <div class="head">
      <Logo size={32} />
      <h1>Mizuyari</h1>
    </div>
    <p class="muted">GitHub와 Google의 활동을 모아 컨디셔닝 미팅 리포트를 만듭니다. 허용된 Google 계정으로만 로그인할 수 있습니다.</p>
    <a class="btn primary" href="/auth/google/start">Google로 로그인</a>
    <p class="hint muted">
      처음 로그인하면 Google Tasks·Calendar 읽기 권한을 함께 요청합니다. 토큰은 암호화되어 저장됩니다.
    </p>
  </div>
</div>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .box {
    width: min(420px, 100%);
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hint {
    font-size: 12px;
    margin: 0;
  }
  p {
    margin: 0;
  }
</style>

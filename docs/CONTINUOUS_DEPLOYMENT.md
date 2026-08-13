# Production continuous deployment

Every push or merge to `main` runs `.github/workflows/deploy-production.yml`:

1. run all frontend/backend tests and a production build;
2. create an immutable bundle containing `dist`, backend source and an offline Python wheelhouse;
3. upload the bundle over SSH (the ECS host never clones or pulls GitHub);
4. verify SHA-256, back up SQLite, install into `/srv/yanpan-dashboard/releases/<sha>` and atomically switch `current`;
5. restart the API, run Nginx/API/static health checks and automatically roll back on failure;
6. verify that `https://yanpan.xieyw.top/version.json` reports the triggering commit.

Production state lives in `/srv/yanpan-dashboard/shared/data` and is never included in a release. The server keeps the latest eight releases and timestamped database backups. The UI header and API status bar expose the deployed short commit SHA.

Manual rollback on ECS:

```bash
sudo /usr/local/sbin/rollback-yanpan-release <40-character-commit-sha>
```

GitHub `production` environment configuration:

- variable `PROD_HOST`
- variable `PROD_USER`
- secret `PROD_SSH_KEY`
- secret `PROD_KNOWN_HOSTS`

生产站点的访问口令由 Nginx 在静态文件和 API 之前统一校验。首次启用或轮换口令时，在服务器运行：

```bash
sudo ACCESS_USERNAME=yanpan ACCESS_PASSWORD='<new-password>' \
  bash deploy/configure-access-password.sh
```

`/version.json` 仅公开版本号、commit SHA 和构建时间，供 GitHub Actions 在不保存站点口令的情况下完成部署验证；页面、静态资源和 API 仍要求登录。

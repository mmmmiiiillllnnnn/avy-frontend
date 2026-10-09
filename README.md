# avy-front

Веб-интерфейс Avy Chat (Next.js 16, standalone). Бэкенд, песочница, Helm-чарт
и docker-compose всего стека живут в соседнем репозитории
[avy-local](../avy-local); ожидается, что оба лежат рядом:

```
projects/
  avy-local/    бэкенд, compose, deploy/helm, deploy/stand
  avy-front/    этот репозиторий
```

Браузер ходит только во фронт: запросы `/api/...` сервер Next проксирует на
бэкенд по адресу из рантайм-переменной `BACKEND_ORIGIN` (по умолчанию
`http://localhost:8000`). В бандл адрес не впекается — один образ годится для
любой среды.

## Разработка

Нужен Node.js 20+. Бэкенд поднимается из avy-local (см. его README).

```bash
npm install
npm run dev          # http://localhost:3000
```

Тесты и типы:

```bash
npm test && npx tsc --noEmit
```

## Образ

```bash
docker build -t avy-chat-web .
```

В compose стека (avy-local) образ собирается сам из `../avy-front`; другой путь
задаётся переменной `AVY_FRONT_DIR`.

## Jenkins

`Jenkinsfile` собирает образ в корпоративной среде — базовый образ и пакеты npm
через Nexus, — проверяет, что контейнер отвечает, и пушит в реестр. Job:
«Pipeline script from SCM», Script Path `Jenkinsfile`. Параметры и нужные
credentials описаны в шапке файла.

Готовый образ выкатывается чартом avy-local:

```bash
helm upgrade --install avy deploy/helm/avy \
  --set images.web.repository=<REGISTRY>/avy/web \
  --set images.web.tag=<tag>
```

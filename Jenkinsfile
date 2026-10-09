// Сборка образа фронта (Dockerfile в корне репозитория) в корпоративном Jenkins и пуш в
// корпоративный реестр — для выкатки на настоящий кластер.
//
// Наружу сборка не ходит: базовый образ — через docker-proxy Nexus, пакеты npm —
// через npm-group Nexus. Job: «Pipeline script from SCM», Script Path
// Jenkinsfile.
//
// Что нужно от Jenkins:
//   * агент с docker (BuildKit: Docker 23+ или DOCKER_BUILDKIT=1 на 18.09+),
//     метка — параметр AGENT_LABEL;
//   * credentials (id — параметрами, пустой id = не используется):
//       NPM_CREDENTIALS_ID       Username/Password к npm-репозиторию Nexus
//                                (пусто — если Nexus отдаёт пакеты анонимно);
//       REGISTRY_CREDENTIALS_ID  Username/Password к реестру, куда пушим;
//       CA_CREDENTIALS_ID        Secret file с корпоративным CA (PEM), если
//                                сертификат Nexus выпущен им.
//   Доступ агента к docker-proxy для базового образа (docker login, доверие к
//   CA) — настройка самого агента, пайплайн его не трогает.
//
// Тег — как в deploy/stand/build.sh репозитория avy-local: коммит (12 знаков). Итоговая ссылка на
// образ — в описании сборки и в артефакте image.env; в Helm её передают так:
//   --set images.web.repository=<REGISTRY>/<IMAGE_NAME> --set images.web.tag=<tag>

pipeline {
    agent { label "${params.AGENT_LABEL ?: 'docker'}" }

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timeout(time: 45, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    parameters {
        string(name: 'AGENT_LABEL', defaultValue: 'docker',
               description: 'Метка агента с docker')
        string(name: 'NODE_IMAGE', defaultValue: 'nexus.corp.local:8082/library/node:20-alpine',
               description: 'Базовый образ node:20-alpine через docker-proxy Nexus')
        string(name: 'NPM_REGISTRY', defaultValue: 'https://nexus.corp.local/repository/npm-group/',
               description: 'npm-репозиторий Nexus (group/proxy на registry.npmjs.org)')
        string(name: 'NPM_CREDENTIALS_ID', defaultValue: 'nexus-npm',
               description: 'Username/Password к NPM_REGISTRY; пусто — анонимно')
        string(name: 'CA_CREDENTIALS_ID', defaultValue: '',
               description: 'Secret file с корпоративным CA (PEM); пусто — не нужен')
        string(name: 'REGISTRY', defaultValue: 'nexus.corp.local:8083',
               description: 'Реестр, куда пушится образ (откуда его тянет кластер)')
        string(name: 'IMAGE_NAME', defaultValue: 'avy/web',
               description: 'Имя образа в реестре')
        string(name: 'REGISTRY_CREDENTIALS_ID', defaultValue: 'nexus-docker',
               description: 'Username/Password к REGISTRY')
        string(name: 'IMAGE_TAG', defaultValue: '',
               description: 'Тег; пусто — коммит (git rev-parse --short=12)')
        booleanParam(name: 'PUSH', defaultValue: true,
                     description: 'Пушить образ (выключить — только собрать и проверить)')
    }

    environment {
        DOCKER_BUILDKIT = '1'
        // Учётка пуша живёт в workspace, а не в ~/.docker агента: агент общий,
        // и чужие сборки не должны ни видеть её, ни перетирать.
        PUSH_DOCKER_CONFIG = "${WORKSPACE}/.docker-push"
    }

    stages {
        stage('Версия') {
            steps {
                script {
                    def tag = params.IMAGE_TAG?.trim()
                    if (!tag) {
                        tag = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
                    }
                    env.IMAGE_REF = "${params.REGISTRY}/${params.IMAGE_NAME}:${tag}"
                    env.GIT_SHA = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    currentBuild.description = env.IMAGE_REF
                    echo "образ: ${env.IMAGE_REF}"
                }
            }
        }

        stage('Сборка') {
            steps {
                script {
                    // Секреты BuildKit — файлы ВНЕ контекста сборки (корень
                    // workspace), во временном каталоге workspace@tmp: в образ они не попадут
                    // даже при ошибке в .dockerignore.
                    def secretsDir = "${pwd(tmp: true)}/build-secrets"
                    env.SECRETS_DIR = secretsDir
                    def creds = []
                    if (params.NPM_CREDENTIALS_ID?.trim()) {
                        creds << usernamePassword(credentialsId: params.NPM_CREDENTIALS_ID.trim(),
                                                  usernameVariable: 'NPM_USER',
                                                  passwordVariable: 'NPM_PASS')
                    }
                    if (params.CA_CREDENTIALS_ID?.trim()) {
                        creds << file(credentialsId: params.CA_CREDENTIALS_ID.trim(), variable: 'CA_FILE')
                    }
                    withCredentials(creds) {
                        // Одинарные кавычки: пароль подставляет shell из env, а
                        // не Groovy, — в лог и в историю процесса он не попадёт.
                        sh '''
                            set -eu
                            rm -rf "$SECRETS_DIR"
                            mkdir -p "$SECRETS_DIR"
                            chmod 700 "$SECRETS_DIR"

                            registry="${NPM_REGISTRY%/}/"
                            {
                                echo "registry=$registry"
                                echo "fund=false"
                                echo "audit=false"
                                echo "update-notifier=false"
                                if [ -n "${NPM_USER:-}" ]; then
                                    # //host/path/:_auth — авторизация только для этого
                                    # registry, на другие адреса npm её не понесёт.
                                    auth=$(printf '%s:%s' "$NPM_USER" "$NPM_PASS" | base64 | tr -d '\\n')
                                    echo "//${registry#*://}:_auth=$auth"
                                fi
                            } > "$SECRETS_DIR/npmrc"

                            secrets="--secret id=npmrc,src=$SECRETS_DIR/npmrc"
                            if [ -n "${CA_FILE:-}" ]; then
                                secrets="$secrets --secret id=ca,src=$CA_FILE"
                            fi

                            docker build \
                                --pull \
                                --build-arg NODE_IMAGE="$NODE_IMAGE" \
                                $secrets \
                                --label org.opencontainers.image.revision="$GIT_SHA" \
                                --label org.opencontainers.image.source="${GIT_URL:-}" \
                                -t "$IMAGE_REF" \
                                .
                        '''
                    }
                }
            }
        }

        stage('Проверка образа') {
            // Тот же смысл, что у readinessProbe в Helm (tcp :3000), плюс ответ
            // на / — ловит битый standalone (нет server.js, статики), до кластера.
            // Порт наружу не публикуем: на общем агенте он мог быть занят.
            steps {
                sh '''
                    set -eu
                    cid=$(docker run -d --rm -e BACKEND_ORIGIN=http://127.0.0.1:1 "$IMAGE_REF")
                    trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
                    for i in $(seq 1 30); do
                        if docker exec "$cid" node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"; then
                            echo "фронт отвечает"
                            exit 0
                        fi
                        sleep 2
                    done
                    echo "фронт не ответил за минуту" >&2
                    docker logs --tail 50 "$cid" >&2 || true
                    exit 1
                '''
            }
        }

        stage('Пуш') {
            when { expression { params.PUSH } }
            steps {
                withCredentials([usernamePassword(credentialsId: params.REGISTRY_CREDENTIALS_ID,
                                                  usernameVariable: 'REG_USER',
                                                  passwordVariable: 'REG_PASS')]) {
                    sh '''
                        set -eu
                        mkdir -p "$PUSH_DOCKER_CONFIG"
                        echo "$REG_PASS" | DOCKER_CONFIG="$PUSH_DOCKER_CONFIG" \
                            docker login "$REGISTRY" -u "$REG_USER" --password-stdin
                        DOCKER_CONFIG="$PUSH_DOCKER_CONFIG" docker push "$IMAGE_REF"
                    '''
                }
                sh '''
                    printf 'AVY_IMAGE_WEB=%s\\n' "$IMAGE_REF" > image.env
                    docker image inspect --format 'AVY_IMAGE_WEB_DIGEST={{index .RepoDigests 0}}' "$IMAGE_REF" >> image.env
                '''
                archiveArtifacts artifacts: 'image.env', fingerprint: true
            }
        }
    }

    post {
        always {
            sh '''
                rm -rf "${SECRETS_DIR:-/nonexistent}" "$PUSH_DOCKER_CONFIG"
                # Локальную копию убираем: образ уже в реестре, а диск агента общий.
                if [ -n "${IMAGE_REF:-}" ]; then docker image rm "$IMAGE_REF" >/dev/null 2>&1 || true; fi
            '''
        }
    }
}

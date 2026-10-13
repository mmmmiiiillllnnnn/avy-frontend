pipeline {
    agent { label "clearAgent&&!static&&rhel8" }

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timeout(time: 45, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    parameters {
        string(name: 'VERSION', defaultValue: 'D-00.000.000',
               description: 'Версия собираемого образа')
        booleanParam(name: 'PUSH', defaultValue: true,
                     description: 'Запушить образ в docker registry и дистрибутив в Nexus')
    }

    environment {
        DOCKER_BUILDKIT = '1'
        PUSH_DOCKER_CONFIG = "${env.WORKSPACE}/.docker-push"
        BASE_IMAGE = "docker-dev.registry.ru/base/docker.io/node:26-alpine"
        DOCKER_REGISTRY = "docker-dev.registry.ru"
        DOCKER_CREDENTIALS_ID = "my-account"
        DOCKER_IMAGE = "ci07774464/ci07774464/avy-frontend"
        NEXUS_CREDENTIALS_ID = "my-account-ru"
        NEXUS_URL = "https://nexus.ru/repository/maven-distr-dev"
        GROUP_ID = "1234567890"
        ARTIFACT_ID = "1234567890"
    }

    stages {
        stage('Присвоение версии') {
            steps {
                script {
                    env.IMAGE_REF = "${env.DOCKER_REGISTRY}/${env.DOCKER_IMAGE}:${params.VERSION}"
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
                    def dockerAuthDir = "${pwd(tmp: true)}/docker-auth"
                    env.SECRETS_DIR = secretsDir
                    env.DOCKER_AUTH_DIR = dockerAuthDir
                    // .npmrc (registry + _auth) хранится в Jenkins в Config
                    // File Management, а не в репозитории и не в коде пайплайна.
                    configFileProvider([configFile(fileId: 'avy-npm', variable: 'NPMRC_FILE')]) {
                        withCredentials([usernamePassword(credentialsId: env.DOCKER_CREDENTIALS_ID,
                                                          usernameVariable: 'REG_USER',
                                                          passwordVariable: 'REG_PASS')]) {
                            sh '''
                                set -eu
                                rm -rf "${SECRETS_DIR}" "${DOCKER_AUTH_DIR}"
                                mkdir -p "${SECRETS_DIR}" "${DOCKER_AUTH_DIR}"
                                chmod 700 "${SECRETS_DIR}" "${DOCKER_AUTH_DIR}"
                                # configFile размечает файл в workspace — переносим его
                                # в $SECRETS_DIR, чтобы он не уехал в контекст сборки.
                                mv "$NPMRC_FILE" "${SECRETS_DIR}/npmrc"

                                # --pull резолвит базовый образ из реестра: без auth
                                # docker-dev отвечает 401. Креды — в отдельном DOCKER_CONFIG.
                                echo "$REG_PASS" | DOCKER_CONFIG="${DOCKER_AUTH_DIR}" \
                                    docker login "${DOCKER_REGISTRY}" -u "$REG_USER" --password-stdin

                                # --- временная диагностика платформ, убрать после починки ---
                                echo "агент (uname -m): $(uname -m)"
                                echo "=== манифест и архитектура rootfs текущего тега ==="
                                raw_manifest=$(DOCKER_CONFIG="${DOCKER_AUTH_DIR}" docker buildx imagetools inspect --raw "${BASE_IMAGE}" || true)
                                echo "$raw_manifest" | head -c 1500; echo
                                cfg_digest=$(printf '%s' "$raw_manifest" | awk 'BEGIN{RS=","} /"config"/{ if (match($0, /sha256:[0-9a-f]+/)) { print substr($0, RSTART, RLENGTH); exit } }')
                                echo "config digest: $cfg_digest"
                                if [ -n "$cfg_digest" ]; then
                                    DOCKER_CONFIG="${DOCKER_AUTH_DIR}" docker buildx imagetools inspect "${BASE_IMAGE}@$cfg_digest" 2>&1 | grep -E '"architecture"|"os"' || true
                                fi
                                echo "=== запуск текущего тега (--platform linux/amd64) ==="
                                DOCKER_CONFIG="${DOCKER_AUTH_DIR}" docker run --rm --platform linux/amd64 "${BASE_IMAGE}" uname -m || echo "amd64-вариант не запускается"
                                echo "=== MediaType тегов-кандидатов (нужен manifest list) ==="
                                for tag in 20.16.0-alpine3.20 20-alpine3.20 20.12.2-alpine 20.11.1-alpine; do
                                    echo "--- node:$tag"
                                    DOCKER_CONFIG="${DOCKER_AUTH_DIR}" docker buildx imagetools inspect "docker-dev.registry.ru/base/docker.io/node:$tag" 2>&1 | grep -E 'MediaType|Digest|Platform' | head -n 40 || true
                                done
                                # --- конец диагностики ---

                                # Зеркало отдаёт мультиархитектурный манифест, но BuildKit
                                # выбирает вариант не той архитектуры (exec format error) —
                                # фиксируем платформу по реальной архитектуре агента.
                                build_platform="linux/$(uname -m | sed -e 's/^x86_64$/amd64/' -e 's/^aarch64$/arm64/')"
                                echo "платформа сборки: $build_platform"
                                DOCKER_CONFIG="${DOCKER_AUTH_DIR}" docker build \
                                    --pull \
                                    --platform "$build_platform" \
                                    --build-arg BASE_IMAGE="${BASE_IMAGE}" \
                                    --secret id=npmrc,src="${SECRETS_DIR}/npmrc" \
                                    --label org.opencontainers.image.revision="${GIT_SHA}" \
                                    --label org.opencontainers.image.source="${GIT_URL:-}" \
                                    -t "${IMAGE_REF}" \
                                    .
                            '''
                        }
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
                    cid=$(docker run -d --rm -e BACKEND_ORIGIN=http://127.0.0.1:1 "${IMAGE_REF}")
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

        // PUSH — единый переключатель публикации: образ и дистрибутив уходят
        // в реестры только вместе (дистрибутив ссылается на дайджест уже
        // запушенного образа).
        stage('Публикация') {
            when { expression { params.PUSH } }
            stages {
                stage('Загрузка образа в Docker Registry') {
                    steps {
                        withCredentials([usernamePassword(credentialsId: env.DOCKER_CREDENTIALS_ID,
                                                          usernameVariable: 'REG_USER',
                                                          passwordVariable: 'REG_PASS')]) {
                            sh '''
                                set -eu
                                mkdir -p "${PUSH_DOCKER_CONFIG}"
                                echo "$REG_PASS" | DOCKER_CONFIG="${PUSH_DOCKER_CONFIG}" \
                                    docker login "${DOCKER_REGISTRY}" -u "$REG_USER" --password-stdin
                                DOCKER_CONFIG="${PUSH_DOCKER_CONFIG}" docker push "${IMAGE_REF}"
                            '''
                        }
                        sh '''
                            printf 'AVY_IMAGE_WEB=%s\\n' "${IMAGE_REF}" > image.env
                            docker image inspect --format 'AVY_IMAGE_WEB_DIGEST={{index .RepoDigests 0}}' "${IMAGE_REF}" >> image.env
                        '''
                        archiveArtifacts artifacts: 'image.env', fingerprint: true
                    }
                }

                stage('Загрузка дистрибутива в Nexus') {
                    // Дайджест манифеста появляется в реестре только после пуша,
                    // поэтому дистрибутив собираем в том же режиме, что и Пуш.
                    // Параметры джобы в sh не попадают — прокидываем явно.
                    environment {
                        VERSION = "${params.VERSION}"
                    }
                    steps {
                        withCredentials([usernamePassword(credentialsId: env.NEXUS_CREDENTIALS_ID,
                                                          usernameVariable: 'NEXUS_USER',
                                                          passwordVariable: 'NEXUS_PASS')]) {
                            sh '''
                                set -eu
                                # RepoDigest — дайджест манифеста образа в реестре: именно
                                # по нему Kubernetes тянет образ, когда в image указан @sha256:...
                                digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "${IMAGE_REF}" | awk -F'@' '{print $2}')
                                echo "дайджест образа: $digest"

                                # Без версии в имени дистрибутива получилось бы
                                # CI07774464--distrib.zip — не пускаем такой мусор в Nexus.
                                if [ -z "${VERSION}" ]; then
                                    echo 'параметр VERSION пуст' >&2
                                    exit 1
                                fi

                                # Версия приходит из параметра джобы; экранируем её и
                                # дайджест для sed (слэши и &).
                                esc() { printf '%s' "$1" | sed -e 's/[\\/&]/\\\\&/g'; }
                                sed -e "s/__APP_VERSION__/$(esc "${VERSION}")/g" \
                                    -e "s/__APP_DIGEST__/$(esc "$digest")/g" \
                                    charts/deployment.yaml.template > charts/dp.yml
                                if grep -q -e '__APP_VERSION__' -e '__APP_DIGEST__' charts/dp.yml; then
                                    echo 'в dp.yml остались плейсхолдеры' >&2
                                    exit 1
                                fi

                                distrib="${ARTIFACT_ID}-${VERSION}-distrib.zip"
                                rm -f "$distrib"
                                # На части агентов нет zip — fallback на python3.
                                # Код передаём через stdin: heredoc-терминатор обязан
                                # стоять в начале строки, и IDE при переформатировании
                                # Jenkinsfile сдвигает его — скрипт перестаёт парситься.
                                if command -v zip >/dev/null 2>&1; then
                                    zip -q "$distrib" charts/dp.yml
                                else
                                    printf '%s\n' \
                                        'import sys, zipfile' \
                                        'with zipfile.ZipFile(sys.argv[1], "w") as z:' \
                                        '    z.write("charts/dp.yml")' | python3 - "$distrib"
                                fi

                                nexus_path="${NEXUS_URL}/${GROUP_ID}/avy-frontend/${ARTIFACT_ID}/${VERSION}/${distrib}"
                                # -f проглатывает тело ответа — без него не отличить
                                # 404 (нет репозитория) от 403 (нет прав) или 400.
                                resp=$(mktemp)
                                http_code=$(curl -sS --retry 3 --retry-delay 2 \
                                    -u "$NEXUS_USER:$NEXUS_PASS" \
                                    -X PUT --upload-file "$distrib" \
                                    -o "$resp" -w '%{http_code}' "$nexus_path") || {
                                    echo 'curl не смог отправить дистрибутив (сеть/сервис)' >&2
                                    cat "$resp" >&2 || true
                                    rm -f "$resp"
                                    exit 1
                                }
                                if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
                                    echo "Nexus ответил HTTP ${http_code} на PUT ${nexus_path}:" >&2
                                    cat "$resp" >&2
                                    rm -f "$resp"
                                    exit 1
                                fi
                                rm -f "$resp"
                                echo "дистрибутив: ${nexus_path} (HTTP ${http_code})"
                            '''
                        }
                        archiveArtifacts artifacts: "${env.ARTIFACT_ID}-*-distrib.zip", fingerprint: true
                    }
                }
            }
        }
    }

    post {
        always {
            sh '''
                rm -rf "${SECRETS_DIR:-/nonexistent}" "${DOCKER_AUTH_DIR:-/nonexistent}" "${PUSH_DOCKER_CONFIG}"
                # Локальную копию убираем: образ уже в реестре, а диск агента общий.
                if [ -n "${IMAGE_REF:-}" ]; then docker image rm "${IMAGE_REF}" >/dev/null 2>&1 || true; fi
            '''
        }
    }
}

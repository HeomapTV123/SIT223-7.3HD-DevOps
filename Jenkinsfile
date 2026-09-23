// Milestone 4: add an automated staging deployment after all quality/security gates.
pipeline {
    agent any
    environment {
        SONAR_SCANNER_IMAGE = 'sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0'
        TRIVY_IMAGE = 'aquasec/trivy:0.74.0'
        STAGING_PROJECT = 'sit223-hd-staging'
        STAGING_CONTAINER = 'sit223-hd-staging'
        STAGING_URL = 'http://127.0.0.1:3001'
    }
    options {
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }
    parameters {
        booleanParam(name: 'VERIFY_STAGING_ROLLBACK', defaultValue: false,
            description: 'Demonstration only: fail Deploy after its checks and restore the previous staging image. Requires a prior successful deployment; this build will fail.')
    }
    stages {
        stage('Build') {
            steps {
                script {
                    env.APP_VERSION = "build-${env.BUILD_NUMBER}"
                    env.APP_IMAGE = "sit223-hd-task-manager:${env.APP_VERSION}"
                    env.TEST_IMAGE = "sit223-hd-task-manager-tests:${env.APP_VERSION}"
                    env.TEST_CONTAINER = "sit223-hd-tests-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                    env.SONAR_CONTAINER = "sit223-hd-sonar-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                    env.SECURITY_CONTAINER = "sit223-hd-security-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                    env.SMOKE_CONTAINER = "sit223-hd-smoke-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                }
                // Refresh both base images and Alpine packages for the security scan.
                bat 'docker build --pull --no-cache --target runtime --build-arg APP_VERSION=%APP_VERSION% -t %APP_IMAGE% .'
                bat 'docker image inspect %APP_IMAGE% > image-metadata.json'
                script {
                    env.APP_IMAGE_ID = bat(returnStdout: true, script: '@docker image inspect --format "{{.Id}}" %APP_IMAGE%').trim()
                    if (!(env.APP_IMAGE_ID ==~ /sha256:[a-f0-9]{64}/)) {
                        error('Could not identify the built runtime image.')
                    }
                }
                bat 'docker run --rm %APP_IMAGE% node --version > runtime-node-version.txt'
                archiveArtifacts artifacts: 'image-metadata.json,runtime-node-version.txt', fingerprint: true
            }
        }
        stage('Test') {
            steps {
                // Reuse this build's refreshed application layers and version in the test target.
                bat 'docker build --target test --build-arg APP_VERSION=%APP_VERSION% -t %TEST_IMAGE% .'
                script {
                    dir('reports') { deleteDir() }
                    try {
                        int testStatus = bat(returnStatus: true, script: 'docker run --name %TEST_CONTAINER% %TEST_IMAGE%')
                        int copyStatus = bat(returnStatus: true, script: 'docker cp %TEST_CONTAINER%:/app/reports .')
                        if (copyStatus != 0) {
                            error('Test reports could not be copied from the container. Check the container log above.')
                        }
                        junit testResults: 'reports/junit.xml', skipPublishingChecks: true
                        archiveArtifacts artifacts: 'reports/*', fingerprint: true
                        if (testStatus != 0) {
                            error('Tests or coverage thresholds failed. Later stages must not run.')
                        }
                    } finally {
                        bat(returnStatus: true, script: 'docker rm -f %TEST_CONTAINER%')
                    }
                }
            }
        }
        stage('Code Quality') {
            steps {
                script {
                    if (!fileExists('reports/lcov.info')) {
                        error('Coverage report is missing. The Test stage must finish before Code Quality.')
                    }
                    dir('.scannerwork') { deleteDir() }
                    try {
                        bat 'docker pull %SONAR_SCANNER_IMAGE%'
                        bat 'docker image inspect %SONAR_SCANNER_IMAGE% > reports/sonar-scanner-image.json'
                        withCredentials([string(credentialsId: 'sonarcloud-token', variable: 'SONAR_TOKEN')]) {
                            // Docker inherits the token by name; its value is not placed in this command.
                            // The scanner reads sonar-project.properties and waits for the quality gate.
                            bat '''@echo off
docker run --name "%SONAR_CONTAINER%" --env SONAR_TOKEN --volume "%WORKSPACE%:/usr/src" --workdir /usr/src "%SONAR_SCANNER_IMAGE%" "-Dsonar.scm.revision=%GIT_COMMIT%"
'''
                        }
                    } finally {
                        bat(returnStatus: true, script: '@docker rm -f "%SONAR_CONTAINER%" >nul 2>&1')
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: '.scannerwork/report-task.txt,reports/sonar-scanner-image.json', allowEmptyArchive: true, fingerprint: true
                }
            }
        }
        stage('Security') {
            steps {
                script {
                    dir('reports/security') {
                        deleteDir()
                        writeFile file: 'scan-context.txt', text: """Build: ${env.BUILD_NUMBER}
Commit: ${env.GIT_COMMIT}
Runtime image: ${env.APP_IMAGE}
Runtime image ID: ${env.APP_IMAGE_ID}
Scanner: ${env.TRIVY_IMAGE}
Policy: fail on any detected HIGH or CRITICAL image vulnerability (no fixed-version filter), or any detected source secret.
"""
                    }
                    dir('reports/security-input') {
                        deleteDir()
                        writeFile file: '.keep', text: ''
                    }
                    try {
                        bat 'docker pull %TRIVY_IMAGE%'
                        bat 'docker image inspect %TRIVY_IMAGE% > reports/security/scanner-image.json'
                        // Export the exact runtime artifact. The scanner does not need the Docker socket.
                        bat 'docker image save --output reports/security-input/app-image.tar %APP_IMAGE_ID%'

                        // Collect all severities first; a separate gate checks this same report.
                        int imageStatus = bat(returnStatus: true, script: '''@echo off
docker run --rm --name "%SECURITY_CONTAINER%" --volume "%WORKSPACE%/reports/security-input:/scan:ro" --volume "%WORKSPACE%/reports/security:/reports" --volume sit223-hd-trivy-cache:/root/.cache/trivy "%TRIVY_IMAGE%" image --input /scan/app-image.tar --scanners vuln --format json --output /reports/trivy-image.json --exit-code 0 --timeout 10m --no-progress
''')
                        // The template includes file, rule, severity and line, never secret values or source snippets.
                        // Exit 10 means findings; other nonzero codes mean the scan did not complete.
                        int secretStatus = bat(returnStatus: true, script: '''@echo off
docker run --rm --name "%SECURITY_CONTAINER%" --volume "%WORKSPACE%:/project:ro" --volume "%WORKSPACE%/reports/security:/reports" --volume sit223-hd-trivy-cache:/root/.cache/trivy --workdir /project "%TRIVY_IMAGE%" filesystem --scanners secret --format template --template @/project/ci/secrets-report.tpl --output /reports/trivy-secrets.txt --exit-code 10 --timeout 5m --no-progress --skip-dirs .git --skip-dirs node_modules --skip-dirs reports --skip-dirs coverage --skip-dirs data --skip-dirs .scannerwork /project
''')
                        writeFile file: 'reports/security/scan-exit-codes.txt', text: "Image scan: ${imageStatus}\nSecret scan: ${secretStatus}\n"
                        if (imageStatus != 0 || !(secretStatus in [0, 10])) {
                            error('A security scan could not complete. Inspect the scanner output; this is not a passing security result.')
                        }
                        if (!fileExists('reports/security/trivy-image.json') || !fileExists('reports/security/trivy-secrets.txt')) {
                            error('A security report is missing. The stage cannot pass without both reports.')
                        }
                        bat '''@echo off
docker run --rm --name "%SECURITY_CONTAINER%" --volume "%WORKSPACE%/reports/security:/reports" "%TRIVY_IMAGE%" convert --scanners vuln --format table --output /reports/trivy-image.txt /reports/trivy-image.json
'''
                        int imageGate = bat(returnStatus: true, script: '''@echo off
docker run --rm --name "%SECURITY_CONTAINER%" --volume "%WORKSPACE%/reports/security:/reports" "%TRIVY_IMAGE%" convert --scanners vuln --format table --severity HIGH,CRITICAL --exit-code 10 --output /reports/trivy-image-gate.txt /reports/trivy-image.json
''')
                        if (!(imageGate in [0, 10])) {
                            error('The image security gate could not evaluate its report. Inspect the output above.')
                        }
                        bat '''@echo off
docker run --rm --name "%SECURITY_CONTAINER%" --volume sit223-hd-trivy-cache:/root/.cache/trivy "%TRIVY_IMAGE%" --version > reports/security/trivy-version.txt
'''
                        bat '@type reports\\security\\trivy-image-gate.txt'
                        bat '@type reports\\security\\trivy-secrets.txt'
                        boolean passed = imageGate == 0 && secretStatus == 0
                        writeFile file: 'reports/security/gate-result.txt', text: """Security gate: ${passed ? 'PASSED' : 'FAILED'}
Image HIGH/CRITICAL gate exit code: ${imageGate}
Source secret gate exit code: ${secretStatus}
Exit 0 means no blocking findings; exit 10 means blocking findings were detected.
See trivy-image.json and trivy-image.txt for all vulnerability severities.
"""
                        if (!passed) {
                            error('Security gate failed. Review reports/security, remediate the reported vulnerabilities or secrets, then rebuild.')
                        }
                    } finally {
                        bat(returnStatus: true, script: '@docker rm -f "%SECURITY_CONTAINER%" >nul 2>&1')
                        dir('reports/security-input') { deleteDir() }
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/security/*', allowEmptyArchive: true, fingerprint: true
                }
            }
        }
        stage('Deploy') {
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                script {
                    dir('reports/deploy') {
                        deleteDir()
                        writeFile file: 'deployment-result.txt', text: 'Deployment: NOT_COMPLETED\n'
                        writeFile file: 'deployment-context.txt', text: """Build: ${env.BUILD_NUMBER}
Commit: ${env.GIT_COMMIT}
Image tag: ${env.APP_IMAGE}
Image ID: ${env.APP_IMAGE_ID}
Environment: staging
URL: ${env.STAGING_URL}
Compose project: ${env.STAGING_PROJECT}
Rollback demonstration requested: ${params.VERIFY_STAGING_ROLLBACK ?: false}
"""
                    }
                    String previousImage = ''
                    boolean replacementStarted = false
                    withEnv(["STAGING_IMAGE=${env.APP_IMAGE_ID}"]) {
                        try {
                            bat 'docker compose version > reports/deploy/compose-version.txt'
                            bat 'docker compose --project-name %STAGING_PROJECT% --file compose.staging.yaml config --quiet'
                            // Refuse to replace a same-name container that belongs to another project.
                            String existing = bat(returnStdout: true, script: '@docker ps -a --filter "name=^/%STAGING_CONTAINER%$" --format "{{.ID}}"').trim()
                            if (existing) {
                                String owned = bat(returnStdout: true, script: '@docker ps -a --filter "name=^/%STAGING_CONTAINER%$" --filter "label=com.docker.compose.project=%STAGING_PROJECT%" --filter "label=com.docker.compose.service=app" --format "{{.ID}}"').trim()
                                if (owned != existing) {
                                    error('The staging container name is already used by a different project. No container was replaced.')
                                }
                                previousImage = bat(returnStdout: true, script: '@docker inspect --format "{{.Image}}" %STAGING_CONTAINER%').trim()
                                if (!(previousImage ==~ /sha256:[a-f0-9]{64}/)) {
                                    error('Could not identify the previous staging image for rollback.')
                                }
                                bat 'docker inspect %STAGING_CONTAINER% > reports/deploy/previous-container.json'
                            }
                            writeFile file: 'reports/deploy/previous-image.txt', text: "${previousImage ?: 'NONE: first deployment'}\n"
                            if (params.VERIFY_STAGING_ROLLBACK && !previousImage) {
                                error('Complete a normal staging deployment before requesting a rollback demonstration.')
                            }
                            if (params.VERIFY_STAGING_ROLLBACK) {
                                String previousHealth = bat(returnStdout: true, script: '@docker inspect --format "{{.State.Health.Status}}" %STAGING_CONTAINER%').trim()
                                if (previousHealth != 'healthy') {
                                    error('The previous staging service must be healthy before demonstrating rollback. Run a normal deployment first.')
                                }
                            }

                            replacementStarted = true
                            // No rebuild or pull: deploy the immutable image that Security scanned.
                            bat 'docker compose --project-name %STAGING_PROJECT% --file compose.staging.yaml up -d --no-build --pull never --wait --wait-timeout 90 app'
                            String deployedImage = bat(returnStdout: true, script: '@docker inspect --format "{{.Image}}" %STAGING_CONTAINER%').trim()
                            if (deployedImage != env.APP_IMAGE_ID) {
                                error('Staging is not running the image that passed Security.')
                            }
                            // A separate client checks HTTP behaviour across the Compose network.
                            bat '''@echo off
docker run --rm --name "%SMOKE_CONTAINER%" --network "%STAGING_PROJECT%_default" --read-only --cap-drop ALL --security-opt no-new-privileges:true --no-healthcheck --volume "%WORKSPACE%/scripts:/checks:ro" "%APP_IMAGE_ID%" node /checks/smoke-deploy.mjs http://app:3000 "%APP_VERSION%" staging > reports/deploy/smoke-test.json
'''
                            // Check the published Windows-host port as well as container-to-container HTTP.
                            powershell '''
$ErrorActionPreference = 'Stop'
$health = Invoke-RestMethod -Uri ($env:STAGING_URL + '/health') -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.environment -ne 'staging' -or $health.version -ne $env:APP_VERSION) {
    throw 'Published staging endpoint did not return the expected health, environment and build version.'
}
$health | ConvertTo-Json | Set-Content -Path 'reports/deploy/host-health.json' -Encoding UTF8
'''
                            if (params.VERIFY_STAGING_ROLLBACK) {
                                error('Intentional Deploy failure requested to demonstrate staging rollback after all checks passed.')
                            }
                            writeFile file: 'reports/deploy/deployment-result.txt', text: """Deployment: PASSED
Environment: staging
URL: ${env.STAGING_URL}
Version: ${env.APP_VERSION}
Image ID: ${deployedImage}
Docker health, HTTP smoke checks and the Windows-host health request passed.
"""
                            echo "Staging is ready at ${env.STAGING_URL} (${env.APP_VERSION})."
                        } catch (failure) {
                            String recovery = 'NOT_NEEDED: deployment did not start'
                            if (replacementStarted) {
                                // Preserve the failed attempt before replacing it during rollback.
                                bat(returnStatus: true, script: '@docker inspect %STAGING_CONTAINER% > reports/deploy/failed-container.json 2> reports/deploy/failed-inspect-error.txt')
                                bat(returnStatus: true, script: '@docker logs --tail 100 %STAGING_CONTAINER% > reports/deploy/failed-container.log 2>&1')
                                try {
                                    if (previousImage) {
                                        withEnv(["STAGING_IMAGE=${previousImage}"]) {
                                            bat 'docker compose --project-name %STAGING_PROJECT% --file compose.staging.yaml up -d --no-build --pull never --wait --wait-timeout 90 app'
                                        }
                                        String restoredImage = bat(returnStdout: true, script: '@docker inspect --format "{{.Image}}" %STAGING_CONTAINER%').trim()
                                        if (restoredImage != previousImage) {
                                            error('Rollback did not restore the previous image.')
                                        }
                                        recovery = "PASSED: previous image restored and healthy (${previousImage})"
                                    } else {
                                        bat 'docker compose --project-name %STAGING_PROJECT% --file compose.staging.yaml stop --timeout 10 app'
                                        recovery = 'NO_PREVIOUS_IMAGE: first deployment stopped; staging data retained'
                                    }
                                } catch (rollbackFailure) {
                                    recovery = "FAILED: ${rollbackFailure.message}"
                                    echo 'Recovery failed. Inspect the deployment artifacts and Docker Desktop before retrying.'
                                }
                            }
                            writeFile file: 'reports/deploy/rollback-result.txt', text: "${recovery}\n"
                            writeFile file: 'reports/deploy/deployment-result.txt', text: "Deployment: FAILED\nReason: ${failure.message}\nRecovery: ${recovery}\n"
                            throw failure
                        } finally {
                            bat(returnStatus: true, script: '@docker rm -f "%SMOKE_CONTAINER%" >nul 2>&1')
                            if (replacementStarted) {
                                bat(returnStatus: true, script: '@docker inspect %STAGING_CONTAINER% > reports/deploy/final-container.json 2> reports/deploy/final-inspect-error.txt')
                                bat(returnStatus: true, script: '@docker logs --tail 100 %STAGING_CONTAINER% > reports/deploy/final-container.log 2>&1')
                            }
                        }
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/deploy/*', allowEmptyArchive: true, fingerprint: true
                }
            }
        }
    }
}

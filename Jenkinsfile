// Seven assessed stages, including persistent production monitoring and email alerts.
pipeline {
    agent any
    environment {
        SONAR_SCANNER_IMAGE = 'sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0'
        TRIVY_IMAGE = 'aquasec/trivy:0.74.0'
        STAGING_PROJECT = 'sit223-hd-staging'
        STAGING_CONTAINER = 'sit223-hd-staging'
        STAGING_URL = 'http://127.0.0.1:3001'
        PRODUCTION_PROJECT = 'sit223-hd-production'
        PRODUCTION_CONTAINER = 'sit223-hd-production'
        PRODUCTION_URL = 'http://127.0.0.1:3002'
        MONITORING_PROJECT = 'sit223-hd-monitoring'
        PROMETHEUS_IMAGE = 'prom/prometheus:v3.13.3'
        ALERTMANAGER_IMAGE = 'prom/alertmanager:v0.34.1'
        GRAFANA_IMAGE = 'grafana/grafana:13.2.2'
    }
    options {
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
    }
    parameters {
        booleanParam(name: 'VERIFY_STAGING_ROLLBACK', defaultValue: false,
            description: 'Demonstration only: fail Deploy after its checks and restore the previous staging image. Requires a prior successful deployment; this build will fail.')
        booleanParam(name: 'VERIFY_PRODUCTION_ROLLBACK', defaultValue: false,
            description: 'Demonstration only: fail Release after its checks and restore the previous production image. Requires a prior successful release; this build will fail. Leave staging rollback unchecked.')
        string(name: 'SMTP_SMARTHOST', defaultValue: 'smtp.gmail.com:587', trim: true,
            description: 'Authenticated STARTTLS SMTP host:port. Change this preset if using another provider. Credentials: monitoring-smtp.')
        string(name: 'SMTP_FROM', defaultValue: '', trim: true,
            description: 'Sender email address allowed by your provider. Blank uses the SMTP credential username.')
        string(name: 'ALERT_EMAIL_TO', defaultValue: '', trim: true,
            description: 'Required: one email address that should receive production outage and recovery notifications.')
        booleanParam(name: 'VERIFY_MONITORING_ALERT', defaultValue: false,
            description: 'Demonstration only: briefly stop production, verify a real outage email, restart it and verify the recovery email. Do not combine with rollback demonstrations.')
    }
    stages {
        stage('Build') {
            steps {
                script {
                    if ([params.VERIFY_STAGING_ROLLBACK, params.VERIFY_PRODUCTION_ROLLBACK, params.VERIFY_MONITORING_ALERT].count { it == true } > 1) {
                        error('Select only one demonstration per build.')
                    }
                    if (!params.ALERT_EMAIL_TO?.trim()) {
                        error('Set ALERT_EMAIL_TO in Build with Parameters and add the monitoring-smtp username/password credential. The first run after merging may only refresh the parameter form.')
                    }
                    env.APP_VERSION = "build-${env.BUILD_NUMBER}"
                    env.APP_IMAGE = "sit223-hd-task-manager:${env.APP_VERSION}"
                    env.TEST_IMAGE = "sit223-hd-task-manager-tests:${env.APP_VERSION}"
                    env.TEST_CONTAINER = "sit223-hd-tests-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                    env.SONAR_CONTAINER = "sit223-hd-sonar-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                    env.SECURITY_CONTAINER = "sit223-hd-security-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                    env.SMOKE_CONTAINER = "sit223-hd-smoke-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
                    env.RELEASE_SMOKE_CONTAINER = "sit223-hd-release-smoke-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
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
        stage('Release') {
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                script {
                    dir('reports/release') {
                        deleteDir()
                        writeFile file: 'release-result.txt', text: 'Release: NOT_COMPLETED\n'
                    }
                    String previousImage = ''
                    boolean replacementStarted = false
                    boolean releaseTagCreated = false
                    withEnv(["PRODUCTION_IMAGE=${env.APP_IMAGE_ID}"]) {
                        try {
                            if (!(env.APP_IMAGE_ID ==~ /sha256:[a-f0-9]{64}/) ||
                                !(env.GIT_COMMIT ==~ /[a-f0-9]{40}/)) {
                                error('Build image or source commit is missing. Run the complete pipeline before releasing.')
                            }
                            String mainCommit = bat(returnStdout: true, script: '@git rev-parse refs/remotes/origin/main').trim()
                            if (env.GIT_COMMIT != mainCommit) {
                                error('Release requires the main commit fetched by this Jenkins checkout.')
                            }
                            if (!fileExists('reports/deploy/deployment-result.txt') ||
                                !readFile('reports/deploy/deployment-result.txt').startsWith('Deployment: PASSED\n')) {
                                error('Release requires a successful staging deployment in this build.')
                            }
                            env.RELEASE_IMAGE = "sit223-hd-task-manager:release-${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(12)}"
                            writeFile file: 'reports/release/release-context.txt', text: """Build: ${env.BUILD_NUMBER}
Build URL: ${env.BUILD_URL}
Commit: ${env.GIT_COMMIT}
Version: ${env.APP_VERSION}
Image ID: ${env.APP_IMAGE_ID}
Candidate release tag: ${env.RELEASE_IMAGE}
Source environment: staging (${env.STAGING_URL})
Target environment: production (${env.PRODUCTION_URL})
Compose project: ${env.PRODUCTION_PROJECT}
Rollback demonstration requested: ${params.VERIFY_PRODUCTION_ROLLBACK ?: false}
"""
                            // Recheck the promotion source before touching the production environment.
                            String stagingOwned = bat(returnStdout: true, script: '@docker ps --filter "name=^/%STAGING_CONTAINER%$" --filter "label=com.docker.compose.project=%STAGING_PROJECT%" --filter "label=com.docker.compose.service=app" --format "{{.ID}}"').trim()
                            if (!stagingOwned) {
                                error('The expected staging service is not running.')
                            }
                            String stagingImage = bat(returnStdout: true, script: '@docker inspect --format "{{.Image}}" %STAGING_CONTAINER%').trim()
                            String stagingHealth = bat(returnStdout: true, script: '@docker inspect --format "{{.State.Health.Status}}" %STAGING_CONTAINER%').trim()
                            if (stagingImage != env.APP_IMAGE_ID || stagingHealth != 'healthy') {
                                error('Staging must still be healthy and running this build\'s checked image before promotion.')
                            }
                            bat 'docker inspect %STAGING_CONTAINER% > reports/release/promoted-from-staging.json'
                            bat 'docker compose version > reports/release/compose-version.txt'
                            bat 'docker compose --project-name %PRODUCTION_PROJECT% --file compose.production.yaml config > reports/release/compose-resolved.yaml'
                            // Never overwrite an existing versioned release tag, even on a repeated stage.
                            String existingTag = bat(returnStdout: true, script: '@docker image ls --quiet --no-trunc --filter "reference=%RELEASE_IMAGE%"').trim()
                            if (existingTag) {
                                error('This release tag already exists. Use a new Jenkins build to create a new release.')
                            }
                            String existing = bat(returnStdout: true, script: '@docker ps -a --filter "name=^/%PRODUCTION_CONTAINER%$" --format "{{.ID}}"').trim()
                            if (existing) {
                                String owned = bat(returnStdout: true, script: '@docker ps -a --filter "name=^/%PRODUCTION_CONTAINER%$" --filter "label=com.docker.compose.project=%PRODUCTION_PROJECT%" --filter "label=com.docker.compose.service=app" --format "{{.ID}}"').trim()
                                if (owned != existing) {
                                    error('The production container name is already used by a different project. No container was replaced.')
                                }
                                previousImage = bat(returnStdout: true, script: '@docker inspect --format "{{.Image}}" %PRODUCTION_CONTAINER%').trim()
                                if (!(previousImage ==~ /sha256:[a-f0-9]{64}/)) {
                                    error('Could not identify the previous production image for rollback.')
                                }
                                bat 'docker inspect %PRODUCTION_CONTAINER% > reports/release/previous-container.json'
                            }
                            writeFile file: 'reports/release/previous-image.txt', text: "${previousImage ?: 'NONE: first release'}\n"
                            if (params.VERIFY_PRODUCTION_ROLLBACK) {
                                if (!previousImage) {
                                    error('Complete a normal production release before requesting a production rollback demonstration.')
                                }
                                String previousHealth = bat(returnStdout: true, script: '@docker inspect --format "{{.State.Health.Status}}" %PRODUCTION_CONTAINER%').trim()
                                if (previousHealth != 'healthy') {
                                    error('The previous production service must be healthy before demonstrating rollback.')
                                }
                            }

                            replacementStarted = true
                            // Promote the same immutable image ID; do not rebuild or download an image.
                            bat 'docker compose --project-name %PRODUCTION_PROJECT% --file compose.production.yaml up -d --no-build --pull never --wait --wait-timeout 90 app'
                            String releasedImage = bat(returnStdout: true, script: '@docker inspect --format "{{.Image}}" %PRODUCTION_CONTAINER%').trim()
                            if (releasedImage != env.APP_IMAGE_ID) {
                                error('Production is not running the image that passed staging and Security.')
                            }
                            bat '''@echo off
docker run --rm --name "%RELEASE_SMOKE_CONTAINER%" --network "%PRODUCTION_PROJECT%_default" --read-only --cap-drop ALL --security-opt no-new-privileges:true --no-healthcheck --volume "%WORKSPACE%/scripts:/checks:ro" "%APP_IMAGE_ID%" node /checks/smoke-deploy.mjs http://app:3000 "%APP_VERSION%" production > reports/release/smoke-test.json
'''
                            powershell '''
$ErrorActionPreference = 'Stop'
$health = Invoke-RestMethod -Uri ($env:PRODUCTION_URL + '/health') -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.environment -ne 'production' -or $health.version -ne $env:APP_VERSION) {
    throw 'Published production endpoint did not return the expected health, environment and build version.'
}
$health | ConvertTo-Json | Set-Content -Path 'reports/release/host-health.json' -Encoding UTF8
'''
                            if (params.VERIFY_PRODUCTION_ROLLBACK) {
                                error('Intentional Release failure requested to demonstrate production rollback after all checks passed.')
                            }
                            // A versioned release tag is created only after every production check passes.
                            bat 'docker image tag %APP_IMAGE_ID% %RELEASE_IMAGE%'
                            releaseTagCreated = true
                            String taggedImage = bat(returnStdout: true, script: '@docker image inspect --format "{{.Id}}" %RELEASE_IMAGE%').trim()
                            if (taggedImage != releasedImage) {
                                error('The release tag does not identify the verified production image.')
                            }
                            bat 'docker image inspect %RELEASE_IMAGE% > reports/release/release-image.json'
                            writeFile file: 'reports/release/release-manifest.txt', text: """Release tag: ${env.RELEASE_IMAGE}
Application version: ${env.APP_VERSION}
Source commit: ${env.GIT_COMMIT}
Jenkins build: ${env.BUILD_NUMBER}
Jenkins URL: ${env.BUILD_URL}
Image ID built, scanned, staged and released: ${releasedImage}
Previous production image ID: ${previousImage ?: 'NONE: first release'}
Source environment: staging
Target environment: production
Production URL: ${env.PRODUCTION_URL}
Production data volume: ${env.PRODUCTION_PROJECT}_production-data
Configuration: compose.production.yaml (archived as compose-resolved.yaml)
Verification: Docker health, image identity, HTTP smoke checks and Windows-host health all passed.
"""
                            writeFile file: 'reports/release/release-result.txt', text: "Release: PASSED\nVersion: ${env.APP_VERSION}\nTag: ${env.RELEASE_IMAGE}\nImage ID: ${releasedImage}\nURL: ${env.PRODUCTION_URL}\n"
                            echo "Production is ready at ${env.PRODUCTION_URL} (${env.APP_VERSION}). Release tag: ${env.RELEASE_IMAGE}"
                        } catch (failure) {
                            String recovery = 'NOT_NEEDED: production replacement did not start'
                            if (replacementStarted) {
                                bat(returnStatus: true, script: '@docker inspect %PRODUCTION_CONTAINER% > reports/release/failed-container.json 2> reports/release/failed-inspect-error.txt')
                                bat(returnStatus: true, script: '@docker logs --tail 100 %PRODUCTION_CONTAINER% > reports/release/failed-container.log 2>&1')
                                try {
                                    if (previousImage) {
                                        withEnv(["PRODUCTION_IMAGE=${previousImage}"]) {
                                            bat 'docker compose --project-name %PRODUCTION_PROJECT% --file compose.production.yaml up -d --no-build --pull never --wait --wait-timeout 90 app'
                                        }
                                        String restoredImage = bat(returnStdout: true, script: '@docker inspect --format "{{.Image}}" %PRODUCTION_CONTAINER%').trim()
                                        if (restoredImage != previousImage) {
                                            error('Production rollback did not restore the previous image.')
                                        }
                                        recovery = "PASSED: previous production image restored and healthy (${previousImage})"
                                    } else {
                                        bat 'docker compose --project-name %PRODUCTION_PROJECT% --file compose.production.yaml stop --timeout 10 app'
                                        recovery = 'NO_PREVIOUS_IMAGE: first release stopped; production data retained'
                                    }
                                } catch (rollbackFailure) {
                                    recovery = "FAILED: ${rollbackFailure.message}"
                                    echo 'Production recovery failed. Inspect the release artifacts and Docker Desktop before retrying.'
                                }
                            }
                            String tagCleanup = 'NOT_NEEDED: no release tag created'
                            if (releaseTagCreated) {
                                int cleanupStatus = bat(returnStatus: true, script: '@docker image rm %RELEASE_IMAGE%')
                                tagCleanup = cleanupStatus == 0 ? 'PASSED: failed release tag removed' : 'FAILED: inspect the release tag manually'
                                // A failed attempt must not retain a manifest claiming successful verification.
                                dir('reports/release') {
                                    if (fileExists('release-manifest.txt')) {
                                        writeFile file: 'release-manifest.txt', text: 'Release invalidated. See release-result.txt.\n'
                                    }
                                }
                            }
                            writeFile file: 'reports/release/rollback-result.txt', text: "${recovery}\n"
                            writeFile file: 'reports/release/release-result.txt', text: "Release: FAILED\nReason: ${failure.message}\nRecovery: ${recovery}\nTag cleanup: ${tagCleanup}\n"
                            echo "Production recovery: ${recovery}"
                            throw failure
                        } finally {
                            bat(returnStatus: true, script: '@docker rm -f "%RELEASE_SMOKE_CONTAINER%" >nul 2>&1')
                            if (replacementStarted) {
                                bat(returnStatus: true, script: '@docker inspect %PRODUCTION_CONTAINER% > reports/release/final-container.json 2> reports/release/final-inspect-error.txt')
                                bat(returnStatus: true, script: '@docker logs --tail 100 %PRODUCTION_CONTAINER% > reports/release/final-container.log 2>&1')
                            }
                        }
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/release/*', allowEmptyArchive: true, fingerprint: true
                }
            }
        }
        stage('Monitoring and Alerting') {
            options { timeout(time: 15, unit: 'MINUTES') }
            steps {
                script {
                    // Separate loaded script keeps the Declarative pipeline method manageable.
                    load 'ci/monitoring.groovy'
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/monitoring/*', allowEmptyArchive: true, fingerprint: true
                }
            }
        }
    }
}

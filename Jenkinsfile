// Milestone 3: Build, Test, Code Quality, and Security on Windows Jenkins.
pipeline {
    agent any
    environment {
        SONAR_SCANNER_IMAGE = 'sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0'
        TRIVY_IMAGE = 'aquasec/trivy:0.74.0'
    }
    options {
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
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
                }
                // Refresh both base images and Alpine packages for the security scan.
                bat 'docker build --pull --no-cache --target runtime --build-arg APP_VERSION=%APP_VERSION% -t %APP_IMAGE% .'
                bat 'docker image inspect %APP_IMAGE% > image-metadata.json'
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
Scanner: ${env.TRIVY_IMAGE}
Policy: fail on any HIGH or CRITICAL image vulnerability, including unfixed findings, or any detected source secret.
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
                        bat 'docker image save --output reports/security-input/app-image.tar %APP_IMAGE%'

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
    }
}

// Milestone 2: Build, Test, and Code Quality on Windows Jenkins.
pipeline {
    agent any
    environment {
        SONAR_SCANNER_IMAGE = 'sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0'
    }
    options {
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
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
                }
                bat 'docker build --target runtime --build-arg APP_VERSION=%APP_VERSION% -t %APP_IMAGE% .'
                bat 'docker image inspect %APP_IMAGE% > image-metadata.json'
                archiveArtifacts artifacts: 'image-metadata.json', fingerprint: true
            }
        }
        stage('Test') {
            steps {
                bat 'docker build --target test -t %TEST_IMAGE% .'
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
    }
}

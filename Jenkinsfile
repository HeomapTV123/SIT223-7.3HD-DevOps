// Milestone 1: the Build and Test stages only.
// Extend this file after the application has been verified locally.
pipeline {
    agent any
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
                        junit testResults: 'reports/junit.xml'
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
    }
}

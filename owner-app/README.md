# 카타르시스 예약 알림

결제가 완료된 예약을 매장 안드로이드 장치에서 확인하는 운영자용 앱입니다.

## 동작

- 최초 실행 시 운영 키와 장치 이름으로 한 번만 연결합니다.
- 운영 키는 저장하지 않으며 서버가 발급한 장치 토큰만 Android Keystore로 암호화해 보관합니다.
- Firebase Cloud Messaging으로 새 예약·취소 신호를 즉시 받고 인증된 서버에서 상세 내용을 동기화합니다.
- 푸시에는 고객명·전화번호·예약번호가 포함되지 않으며, 백그라운드 WorkManager와 30초 연결은 누락 복구용으로 작동합니다.
- 예약 이력은 SQLite에 저장되며 최신순 목록, 읽음 상태, 상세 정보와 예약번호 복사를 지원합니다.
- Android 13 이상에서는 처음 연결할 때 알림 권한을 요청합니다.

## Android Studio

- JDK 17
- Gradle 8.9
- Android SDK 35 및 Build Tools 35.0.0

`owner-app` 폴더를 프로젝트로 열고 Gradle 8.9를 선택한 뒤 `app` 구성을 실행합니다.

API 주소는 `OWNER_API_BASE` Gradle 속성 또는 환경변수로 바꿀 수 있습니다. 값은 반드시 `https://`로 시작해야 하며, 비어 있으면 현재 운영 API 주소를 사용합니다. 추후 전용 도메인으로 이전할 때는 GitHub 저장소의 `Settings` → `Secrets and variables` → `Actions` → `Variables`에서 `OWNER_API_BASE`만 바꾼 뒤 새 APK를 빌드하면 됩니다.

Firebase Android 앱의 공개 설정값은 다음 Gradle 속성 또는 환경변수로 전달합니다. 패키지명은 `kr.co.catharsis.owner`입니다.

- `OWNER_FIREBASE_APP_ID`
- `OWNER_FIREBASE_PROJECT_ID`
- `OWNER_FIREBASE_SENDER_ID`
- `OWNER_FIREBASE_API_KEY`

서버 서비스 계정의 개인키는 Android 프로젝트나 GitHub에 넣지 않습니다.

## 자동 빌드와 설치 파일

`main` 브랜치의 `owner-app` 변경사항을 푸시하거나 GitHub Actions에서 `Build owner APK`를 실행하면 단위 테스트 후 두 artifact를 만듭니다.

- `Catharsis-Owner-Installable-APK`: 휴대전화에 바로 설치해 동작을 확인할 수 있는 디버그 서명본입니다.
- `Catharsis-Owner-Unsigned-APK`: 매장에서 계속 사용할 배포본을 만들기 위한 미서명 release 파일입니다. 그대로는 설치할 수 없습니다.

설치 가능한 디버그 서명본은 빌드 실행마다 서명 인증서가 바뀔 수 있습니다. 다음 빌드 파일이 기존 앱 위에 업데이트되지 않으면 기존 앱을 삭제한 뒤 설치해야 하며, 삭제하면 장치 연결과 기기 안의 예약 이력도 함께 지워집니다. 매장 운영용 업데이트는 아래의 고정 keystore로 서명한 release 파일만 사용합니다.

GitHub Actions의 Firebase 변수 네 개가 모두 비어 있어도 앱은 빌드되고 동작합니다. 이 경우 앱을 열어 둔 동안 30초 간격으로 확인하고, 백그라운드에서는 Android가 허용하는 주기에 따라 WorkManager가 확인합니다. Firebase 변수를 모두 등록하면 새 예약 신호를 즉시 받아 동기화하며, 정기 확인은 누락 복구용으로 계속 유지됩니다.

## 매장 운영용 APK 서명

서명 keystore는 공개 저장소, GitHub artifact, 메신저에 올리지 않습니다. 처음 한 번만 만든 뒤 암호화된 오프라인 저장소에 백업하고 이후 모든 업데이트에 같은 파일과 alias를 사용합니다. keystore를 잃어버리면 기존 설치본 위에 업데이트할 수 없습니다.

저장소 밖의 개인 디렉터리에 키를 만듭니다.

```bash
install -d -m 700 "$HOME/.catharsis-signing"
keytool -genkeypair -v \
  -keystore "$HOME/.catharsis-signing/catharsis-owner.jks" \
  -alias catharsis-owner \
  -keyalg RSA -keysize 4096 -validity 10000
chmod 600 "$HOME/.catharsis-signing/catharsis-owner.jks"
```

Actions에서 받은 `Catharsis-Owner-unsigned.apk`를 저장소 밖의 작업 폴더에 내려받은 뒤 다음처럼 서명합니다. 비밀번호를 환경변수로 미리 넣지 않으면 스크립트가 화면에 표시하지 않고 물어봅니다.

```bash
export OWNER_KEYSTORE_PATH="$HOME/.catharsis-signing/catharsis-owner.jks"
export OWNER_KEY_ALIAS="catharsis-owner"
./owner-app/scripts/sign-release.sh \
  /absolute/path/Catharsis-Owner-unsigned.apk \
  /absolute/path/Catharsis-Owner.apk
```

스크립트는 최신 Android Build Tools의 `zipalign`과 `apksigner`를 사용해 서명·검증한 뒤 APK와 SHA-256 파일을 만듭니다. 비밀번호는 명령행 인수나 저장소 파일에 기록하지 않습니다.

## 업데이트 규칙

Android가 기존 앱 위에 업데이트를 허용하려면 패키지명 `kr.co.catharsis.owner`가 같고, 서명 인증서가 같으며, 새 APK의 `versionCode`가 더 높아야 합니다. Actions 빌드는 저장소의 실행 번호를 `versionCode`로 사용합니다. 운영 APK를 만들 때는 항상 같은 저장소의 새 실행에서 unsigned 파일을 받고 같은 고정 keystore로 서명합니다.

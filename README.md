# ShyTalk

**Voice chat rooms, reimagined.**

[![Android](https://img.shields.io/badge/Platform-Android-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.0-blue.svg)](https://kotlinlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## About

ShyTalk is a social voice chat app where users can create and join real-time voice chat rooms. Built with Kotlin Multiplatform, it targets both Android and iOS with a shared codebase. Whether you want to host a conversation, listen in, or connect with people around the world, ShyTalk makes it easy.

## Features

- **Voice Chat Rooms** — Create or join rooms with real-time voice powered by Agora SDK
- **Seat Management** — Structured seating system with owner, host, and attendee roles
- **Real-Time Messaging** — Live text chat alongside voice in every room
- **User Profiles** — Customizable profiles with photos, cover images, nationality flags, and bios
- **Follow System** — Follow other users and see when they're active
- **Moderation Tools** — Mute, kick, move seats, and manage hosts as a room owner
- **Seat Requests & Invites** — Request to join a seat or invite listeners to speak
- **Floating Chathead** — Continue voice chat while browsing other parts of the app
- **Block System** — Block users across rooms and profiles
- **Room Expiry** — Rooms auto-close when the owner is away, with countdown timers

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architecture** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Auth** | Firebase Authentication (Google Sign-In) |
| **Database** | Cloud Firestore |
| **Storage** | Firebase Storage |
| **Cloud Functions** | Firebase Functions (Node.js) |
| **Voice** | Agora Voice SDK |
| **Image Loading** | Coil 3 (KMP) |
| **Date/Time** | kotlinx-datetime |
| **Navigation** | Compose Navigation |

## Architecture

ShyTalk follows **MVVM** with a clean **Repository Pattern**:

```
┌─────────────────────────────────────────────┐
│                    UI Layer                  │
│  Compose Screens → ViewModels → UI State    │
├─────────────────────────────────────────────┤
│                  Domain Layer                │
│         Repository Interfaces                │
├─────────────────────────────────────────────┤
│                  Data Layer                  │
│  Repository Impls → Firebase / Agora         │
└─────────────────────────────────────────────┘
```

- **shared module** (`commonMain`) — Models, repositories, ViewModels, and UI shared across platforms
- **app module** — Android-specific screens and entry point
- **iosApp module** — iOS-specific entry point

## Project Structure

```
ShyTalk/
├── app/                          # Android app module
│   └── src/main/java/.../
│       ├── ShyTalkApp.kt         # Application entry point
│       ├── MainActivity.kt       # Main activity
│       └── feature/
│           ├── auth/             # Google Sign-In screen
│           ├── profile/          # Profile screen
│           ├── room/             # Room screen & components
│           └── settings/         # App settings
├── shared/                       # KMP shared module
│   └── src/commonMain/kotlin/.../
│       ├── core/
│       │   ├── di/               # Koin DI modules
│       │   ├── model/            # Data models (User, ChatRoom, Seat, etc.)
│       │   └── util/             # Utilities & constants
│       ├── data/
│       │   ├── remote/           # Agora voice service
│       │   └── repository/       # Repository interfaces & implementations
│       ├── feature/
│       │   ├── auth/             # Auth ViewModel
│       │   ├── home/             # Home screen & room list
│       │   ├── main/             # Main screen with navigation
│       │   ├── profile/          # Profile ViewModel
│       │   ├── room/             # Room ViewModel
│       │   └── settings/         # Settings screens
│       ├── navigation/           # Navigation routes
│       └── ui/
│           ├── components/       # Shared UI components
│           └── theme/            # Color palette & theming
├── iosApp/                       # iOS app module
├── functions/                    # Firebase Cloud Functions
├── public/                       # Landing page (Firebase Hosting)
└── firebase.json                 # Firebase configuration
```

## Getting Started

### Prerequisites

- **Android Studio** Ladybug or newer
- **JDK 11+**
- **Firebase project** with Firestore, Auth, Storage, and Functions enabled
- **Agora account** with an App ID

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/shyden/ShyTalk.git
   cd ShyTalk
   ```

2. **Firebase configuration**
   - Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
   - Enable **Phone Authentication** and **Google Sign-In**
   - Download `google-services.json` and place it in `app/`

3. **Agora configuration**
   - Sign up at [agora.io](https://www.agora.io) and create a project
   - Copy your App ID into `AgoraVoiceService.kt`

4. **Deploy Cloud Functions**
   ```bash
   cd functions
   npm install
   firebase deploy --only functions
   ```

5. **Build and run**
   ```bash
   ./gradlew assembleDebug
   ```

### Configuration

| Item | Location | Description |
|------|----------|-------------|
| Firebase | `app/google-services.json` | Firebase project config |
| Agora App ID | `AgoraVoiceService.kt` | Voice chat engine credentials |
| Web Client ID | `GoogleSignInScreen.kt` | Google OAuth client ID |
| Firestore Rules | `database.rules.json` | Security rules for Firestore |

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes with clear messages
4. Push to your fork and open a Pull Request

### Code Style

- Follow Kotlin coding conventions
- Use meaningful names for variables, functions, and classes
- Keep composables focused and modular
- Write ViewModels with unidirectional data flow (StateFlow + UI State)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Firebase](https://firebase.google.com) — Authentication, Firestore, Storage, Functions, Hosting
- [Agora](https://www.agora.io) — Real-time voice communication
- [Jetpack Compose](https://developer.android.com/jetpack/compose) — Modern declarative UI
- [Koin](https://insert-koin.io) — Lightweight dependency injection
- [Coil](https://coil-kt.github.io/coil/) — Image loading for Kotlin Multiplatform
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) — Multiplatform date/time

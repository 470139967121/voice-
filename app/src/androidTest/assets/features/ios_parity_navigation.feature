Feature: iOS Parity — Shared Navigation
  As a user on any platform
  I want all navigation routes to work identically
  So that iOS and Android have the same experience

  # These scenarios verify that shared navigation routes work correctly
  # when the NavGraph is moved to commonMain. They test the same flows
  # that iOS will use via Compose Multiplatform.

  Background:
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the main screen

  Scenario: Authenticated user lands on main screen with all tabs
    Then I should see the element with tag "main_roomsTab"
    And I should see the element with tag "main_messagesTab"
    And I should see the element with tag "main_profileTab"

  Scenario: Navigate from rooms to a voice room
    When I tap the text "Chill Zone"
    Then I should see the element with tag "room_backButton"

  Scenario: Navigate to user profile from room
    When I tap the "Profile" tab
    Then I should see the element with tag "profile_displayName"

  Scenario: Navigate to settings from profile
    When I tap the element with tag "main_settingsButton"
    Then I should see the element with tag "settings_backButton"

  Scenario: Navigate to new message from messages tab
    When I tap the "Messages" tab
    And I tap the element with tag "main_newMessageFab"
    Then I should see the element with tag "newMessage_searchField"

  Scenario: Navigate to wallet
    When I tap the "Profile" tab
    And I tap the element with tag "profile_walletButton"
    Then I should see the element with tag "wallet_backButton"

  Scenario: Settings sign-out returns to sign-in screen
    When I tap the element with tag "main_settingsButton"
    And I tap the element with tag "settings_signOutButton"
    Then I should see the element with tag "signIn_googleButton"

  Scenario: Legal screens are accessible from settings
    When I tap the element with tag "main_settingsButton"
    And I tap the element with tag "settings_privacyPolicyButton"
    Then I should see the text "Privacy Policy"

  Scenario: Follow list navigation from profile
    When I tap the "Profile" tab
    And I tap the element with tag "profile_followersButton"
    Then I should see the element with tag "followList_backButton"

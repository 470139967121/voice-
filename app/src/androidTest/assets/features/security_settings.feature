Feature: Security Settings
  As a user
  I want to manage my security preferences
  So that I can control app lock, biometric, and PIN

  Background:
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the "security_settings" screen

  Scenario: Shows all security options
    Then I should see the element with tag "appLockToggle"
    And I should see the element with tag "biometricToggle"
    And I should see the element with tag "resetPinSetting"
    And I should see the element with tag "linkedAccountsSetting"

  Scenario: App lock enabled by default with timeout visible
    Then I should see the text "App Lock"
    And I should see the element with tag "lockTimeoutSetting"

  Scenario: Disabling app lock hides timeout
    When I tap the element with tag "appLockToggle"
    And I wait 500 milliseconds
    Then I should not see the element with tag "lockTimeoutSetting"

  Scenario: Linked accounts navigates correctly
    When I tap the element with tag "linkedAccountsSetting"
    And I wait 1000 milliseconds
    Then I should see the text "Linked Accounts"

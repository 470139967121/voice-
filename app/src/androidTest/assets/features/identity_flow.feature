Feature: Identity Flow
  As a returning user
  I want the app to route me correctly after sign-in
  So that I land on the right screen

  Scenario: Authenticated user lands on main screen
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the main screen
    Then I should see the element with tag "main_roomsTab"

  Scenario: New user routes to profile setup
    Given I am authenticated as "new-user"
    And I am on the "profile_setup" screen
    Then I should see the element with tag "profileSetup_displayNameField"

  Scenario: Existing user routes to main screen
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the main screen
    Then I should see the element with tag "main_messagesTab"

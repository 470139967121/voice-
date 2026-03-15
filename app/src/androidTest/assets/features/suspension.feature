Feature: Suspension
  As a suspended user
  I want to understand why I am suspended
  So that I can appeal or wait for reinstatement

  Scenario: Shows suspended title
    Given I am authenticated as "test-user-1"
    And I am on the "suspension" screen
    Then I should see the element with tag "suspension_title"

  Scenario: Shows appeal field if eligible
    Given I am authenticated as "test-user-1"
    And I am on the "suspension" screen
    Then I should see the element with tag "suspension_appealField"

  Scenario: Shows sign-out button
    Given I am authenticated as "test-user-1"
    And I am on the "suspension" screen
    Then I should see the element with tag "suspension_signOutButton"

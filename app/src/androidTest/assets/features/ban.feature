Feature: Ban
  As a banned user
  I want to see the reason for my ban
  So that I understand what happened

  Background:
    Given I am authenticated as "test-user-1"
    And I am on the "ban" screen

  Scenario: Shows ban title
    Then I should see the element with tag "ban_title"

  Scenario: Shows ban reason
    Then I should see the element with tag "ban_reason"

  Scenario: Shows sign-out button
    Then I should see the element with tag "ban_signOutButton"

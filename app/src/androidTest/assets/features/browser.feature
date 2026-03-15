Feature: Browser
  As a user
  I want to view web content in-app
  So that I don't leave the app for links

  Scenario: Shows back button
    Given I am authenticated as "test-user-1"
    And I am on the "browser" screen
    Then I should see the element with tag "browser_backButton"

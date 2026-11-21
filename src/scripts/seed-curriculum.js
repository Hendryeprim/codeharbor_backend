import prisma from '../database/prisma.js';

export const defaultSkills = [
  {
    name: 'Python',
    slug: 'python',
    description: 'Python core programming, object-oriented concepts, algorithms, and application development.',
    icon: 'Code2',
    tasks: [
      // BASIC
      {
        level: 'BASIC',
        title: 'Python Calculator',
        description: 'Build an interactive arithmetic calculator that performs addition, subtraction, multiplication, and division.',
        instructions: 'Write a Python program that defines arithmetic functions add(a, b), subtract(a, b), multiply(a, b), divide(a, b) and prints results for sample values (10, 5). Handle division by zero.',
        expectedOutput: 'Sum: 15\nDifference: 5\nProduct: 50\nQuotient: 2.0',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/python-basic-calculator.git',
        githubBranch: 'main',
        initialCode: `# Python Calculator Task
def add(a, b):
    return a + b

def subtract(a, b):
    return a - b

def multiply(a, b):
    return a * b

def divide(a, b):
    if b == 0:
        return "Cannot divide by zero"
    return a / b

# Test cases
num1 = 10
num2 = 5
print(f"Sum: {add(num1, num2)}")
print(f"Difference: {subtract(num1, num2)}")
print(f"Product: {multiply(num1, num2)}")
print(f"Quotient: {divide(num1, num2)}")
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'BASIC',
        title: 'Palindrome & String Analyzer',
        description: 'Create a function to check whether a given string is a palindrome and count vowels and consonants.',
        instructions: 'Implement is_palindrome(text) and analyze_string(text). Test with "radar" and "python". Print the results.',
        expectedOutput: 'radar is palindrome: True\npython is palindrome: False\nVowels in python: 1\nConsonants in python: 5',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/python-string-analyzer.git',
        githubBranch: 'main',
        initialCode: `def is_palindrome(s):
    cleaned = s.lower().replace(" ", "")
    return cleaned == cleaned[::-1]

def analyze_string(s):
    vowels = set("aeiou")
    v_count = sum(1 for c in s.lower() if c in vowels)
    c_count = sum(1 for c in s.lower() if c.isalpha() and c not in vowels)
    return v_count, c_count

print("radar is palindrome:", is_palindrome("radar"))
print("python is palindrome:", is_palindrome("python"))
v, c = analyze_string("python")
print(f"Vowels in python: {v}")
print(f"Consonants in python: {c}")
`,
        isRequired: true,
        orderIndex: 2,
      },
      // INTERMEDIATE
      {
        level: 'INTERMEDIATE',
        title: 'JSON Data Parser & Filter',
        description: 'Parse a collection of user records in JSON format and filter active users with age >= 21.',
        instructions: 'Parse sample JSON array of user records with fields (id, name, age, active). Return sorted names of active adult users.',
        expectedOutput: 'Active Adult Users:\n- Alice (Age 25)\n- Charlie (Age 32)',
        difficulty: 'MEDIUM',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/python-json-parser.git',
        githubBranch: 'main',
        initialCode: `import json

raw_data = '''[
  {"id": 1, "name": "Alice", "age": 25, "active": true},
  {"id": 2, "name": "Bob", "age": 19, "active": true},
  {"id": 3, "name": "Charlie", "age": 32, "active": true},
  {"id": 4, "name": "Diana", "age": 28, "active": false}
]'''

users = json.loads(raw_data)
active_adults = [u for u in users if u['active'] and u['age'] >= 21]
active_adults.sort(key=lambda x: x['name'])

print("Active Adult Users:")
for u in active_adults:
    print(f"- {u['name']} (Age {u['age']})")
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'INTERMEDIATE',
        title: 'OOP Bank Account Management',
        description: 'Implement a BankAccount class with deposit, withdraw, balance inquiry, and transaction history.',
        instructions: 'Create BankAccount with account_holder, balance. Include deposit(amount), withdraw(amount), and get_statement().',
        expectedOutput: 'Deposit 500 successful. Balance: 1500\nWithdrawal 200 successful. Balance: 1300\nFinal Balance: 1300',
        difficulty: 'MEDIUM',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/python-oop-bank.git',
        githubBranch: 'main',
        initialCode: `class BankAccount:
    def __init__(self, holder, initial_balance=1000):
        self.holder = holder
        self.balance = initial_balance
        self.history = []

    def deposit(self, amount):
        self.balance += amount
        self.history.append(f"Deposit +{amount}")
        print(f"Deposit {amount} successful. Balance: {self.balance}")

    def withdraw(self, amount):
        if amount > self.balance:
            print("Insufficient funds")
            return
        self.balance -= amount
        self.history.append(f"Withdraw -{amount}")
        print(f"Withdrawal {amount} successful. Balance: {self.balance}")

acc = BankAccount("John Doe", 1000)
acc.deposit(500)
acc.withdraw(200)
print(f"Final Balance: {acc.balance}")
`,
        isRequired: true,
        orderIndex: 2,
      },
      // ADVANCED
      {
        level: 'ADVANCED',
        title: 'Inventory Management Full-Stack System',
        description: 'Full-stack Inventory Management application with REST API endpoints, SQLite persistence, and real-time dashboard UI.',
        instructions: 'Build a multi-file project with models.py, database.py, app.py and HTML interface. Support item creation, quantity adjustment, low stock alerts, and JSON export.',
        expectedOutput: 'Server running on port 8000. Inventory database initialized with 5 sample products.',
        difficulty: 'HARD',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/python-advanced-inventory.git',
        githubBranch: 'main',
        initialCode: `# Multi-file Advanced Project Entry Point (main.py)
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

inventory = [
    {"id": 101, "name": "Wireless Mouse", "stock": 45, "price": 29.99},
    {"id": 102, "name": "Mechanical Keyboard", "stock": 18, "price": 89.99},
    {"id": 103, "name": "27-inch 4K Monitor", "stock": 5, "price": 349.99}
]

print("✓ Inventory Database Loaded: 3 Items")
for item in inventory:
    print(f"- {item['name']}: {item['stock']} units @ \${item['price']}")
print("Server ready for live preview.")
`,
        isRequired: true,
        orderIndex: 1,
      },
    ],
  },
  {
    name: 'Java',
    slug: 'java',
    description: 'Java language fundamentals, object-oriented design, collections, and enterprise architecture.',
    icon: 'Coffee',
    tasks: [
      {
        level: 'BASIC',
        title: 'Java Calculator',
        description: 'Implement a Java console program for basic mathematical arithmetic operations.',
        instructions: 'Create a class Calculator with methods add, subtract, multiply, divide. Print outputs for a=20, b=4.',
        expectedOutput: 'Sum: 24\nDifference: 16\nProduct: 80\nQuotient: 5.0',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/java-basic-calculator.git',
        githubBranch: 'main',
        initialCode: `public class Solution {
    public static int add(int a, int b) { return a + b; }
    public static int subtract(int a, int b) { return a - b; }
    public static int multiply(int a, int b) { return a * b; }
    public static double divide(int a, int b) { return (double) a / b; }

    public static void main(String[] args) {
        int a = 20;
        int b = 4;
        System.out.println("Sum: " + add(a, b));
        System.out.println("Difference: " + subtract(a, b));
        System.out.println("Product: " + multiply(a, b));
        System.out.println("Quotient: " + divide(a, b));
    }
}
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'BASIC',
        title: 'Array Statistics & Frequency',
        description: 'Find minimum, maximum, average, and number frequency in an integer array.',
        instructions: 'Define an integer array {12, 5, 27, 8, 5, 42, 19}. Print min, max, average, and count of 5.',
        expectedOutput: 'Min: 5\nMax: 42\nAverage: 16.85\nCount of 5: 2',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/java-array-stats.git',
        githubBranch: 'main',
        initialCode: `public class Solution {
    public static void main(String[] args) {
        int[] numbers = {12, 5, 27, 8, 5, 42, 19};
        int min = numbers[0];
        int max = numbers[0];
        int sum = 0;
        int count5 = 0;

        for (int n : numbers) {
            if (n < min) min = n;
            if (n > max) max = n;
            sum += n;
            if (n == 5) count5++;
        }

        double avg = (double) sum / numbers.length;
        System.out.println("Min: " + min);
        System.out.println("Max: " + max);
        System.out.printf("Average: %.2f\\n", avg);
        System.out.println("Count of 5: " + count5);
    }
}
`,
        isRequired: true,
        orderIndex: 2,
      },
      {
        level: 'INTERMEDIATE',
        title: 'Employee Management using Collections',
        description: 'Build an Employee Management System using Java ArrayList, HashMap, and Comparable sorting.',
        instructions: 'Create an Employee class with id, name, salary, and department. Add methods to sort by salary and filter by department.',
        expectedOutput: 'Sorted Employees by Salary:\n- Alice ($85,000)\n- Bob ($65,000)',
        difficulty: 'MEDIUM',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/java-collections-emp.git',
        githubBranch: 'main',
        initialCode: `import java.util.*;

public class Solution {
    static class Employee {
        String name;
        int salary;
        String dept;
        Employee(String n, int s, String d) { name = n; salary = s; dept = d; }
    }

    public static void main(String[] args) {
        List<Employee> staff = new ArrayList<>();
        staff.add(new Employee("Bob", 65000, "Engineering"));
        staff.add(new Employee("Alice", 85000, "Engineering"));

        staff.sort((e1, e2) -> Integer.compare(e2.salary, e1.salary));
        System.out.println("Sorted Employees by Salary:");
        for (Employee e : staff) {
            System.out.println("- " + e.name + " ($" + e.salary + ")");
        }
    }
}
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'ADVANCED',
        title: 'Enterprise Spring Boot Microservice',
        description: 'Design and implement an enterprise-grade RESTful API service with layered architecture and PostgreSQL persistence.',
        instructions: 'Implement controller, service, repository layers with data validation and OpenAPI documentation.',
        expectedOutput: 'Tomcat started on port 8080. Microservice endpoints active: /api/v1/products, /api/v1/orders.',
        difficulty: 'HARD',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/java-advanced-microservice.git',
        githubBranch: 'main',
        initialCode: `// Enterprise Java Service Entry Point
public class Solution {
    public static void main(String[] args) {
        System.out.println("Initializing Enterprise Java Microservice...");
        System.out.println("✓ PostgreSQL Connection Pool Established: 10 active connections");
        System.out.println("✓ Loaded 14 REST Controllers on port 8080");
        System.out.println("✓ Ready for production traffic.");
    }
}
`,
        isRequired: true,
        orderIndex: 1,
      },
    ],
  },
  {
    name: 'SQL',
    slug: 'sql',
    description: 'Relational database querying, multi-table joins, aggregations, schema design, and indexing.',
    icon: 'Database',
    tasks: [
      {
        level: 'BASIC',
        title: 'Employee Table Creation & Basic Select',
        description: 'Create an employees table with primary key and insert records, then retrieve active employees.',
        instructions: 'Write SQL statements to create table employees(id INT, name TEXT, department TEXT, salary INT, is_active INT). Insert 3 rows and select all records where is_active = 1.',
        expectedOutput: 'Query: SELECT * FROM employees WHERE is_active = 1;\nid | name | department | salary | is_active\n---+------+------------+--------+----------\n1  | Arun | Tech       | 75000  | 1',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/sql-basic-select.git',
        githubBranch: 'main',
        initialCode: `-- Create Table and Insert Data
CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    salary INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1
);

INSERT INTO employees VALUES (1, 'Arun', 'Engineering', 75000, 1);
INSERT INTO employees VALUES (2, 'Priya', 'Marketing', 62000, 1);
INSERT INTO employees VALUES (3, 'Karthik', 'HR', 55000, 0);

-- Query active employees
SELECT id, name, department, salary FROM employees WHERE is_active = 1;
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'BASIC',
        title: 'Aggregation with GROUP BY and HAVING',
        description: 'Calculate average department salaries and filter departments with average salary > 60000.',
        instructions: 'Group employees by department, compute COUNT(*) as emp_count, and AVG(salary). Filter with HAVING avg_salary >= 60000.',
        expectedOutput: 'department | avg_salary | total_staff\n-----------+------------+------------\nEngineering| 75000      | 1',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/sql-aggregations.git',
        githubBranch: 'main',
        initialCode: `CREATE TABLE staff (
    id INTEGER PRIMARY KEY,
    name TEXT,
    department TEXT,
    salary INTEGER
);

INSERT INTO staff VALUES (1, 'Arun', 'Engineering', 85000);
INSERT INTO staff VALUES (2, 'Meena', 'Engineering', 90000);
INSERT INTO staff VALUES (3, 'David', 'Sales', 52000);
INSERT INTO staff VALUES (4, 'Sara', 'Sales', 48000);

SELECT 
    department, 
    COUNT(*) as total_staff, 
    AVG(salary) as avg_salary 
FROM staff 
GROUP BY department 
HAVING AVG(salary) > 60000;
`,
        isRequired: true,
        orderIndex: 2,
      },
      {
        level: 'INTERMEDIATE',
        title: 'Multi-Table Relational JOINs',
        description: 'Perform INNER JOIN and LEFT JOIN between orders, customers, and order_items tables.',
        instructions: 'Write queries joining customers and orders to show customer names with their total order spend.',
        expectedOutput: 'customer_name | total_orders | total_spent\n--------------+--------------+------------\nArun Kumar    | 2            | 1240.00',
        difficulty: 'MEDIUM',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/sql-joins.git',
        githubBranch: 'main',
        initialCode: `CREATE TABLE customers (
    customer_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE orders (
    order_id INTEGER PRIMARY KEY,
    customer_id INTEGER,
    amount DECIMAL(10, 2)
);

INSERT INTO customers VALUES (1, 'Arun Kumar');
INSERT INTO customers VALUES (2, 'Kavitha S');

INSERT INTO orders VALUES (101, 1, 540.00);
INSERT INTO orders VALUES (102, 1, 700.00);
INSERT INTO orders VALUES (103, 2, 320.00);

SELECT 
    c.name AS customer_name,
    COUNT(o.order_id) AS total_orders,
    SUM(o.amount) AS total_spent
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.customer_id, c.name;
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'ADVANCED',
        title: 'Full E-Commerce Data Warehouse Schema',
        description: 'Design a complete star-schema dimensional warehouse with fact and dimension tables, indexing, and window analytics.',
        instructions: 'Implement fact_sales and dimension tables with complex window queries computing running totals and month-over-month growth.',
        expectedOutput: 'Schema generated. Running total and 30-day moving average calculated across 1,000 transactions.',
        difficulty: 'HARD',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/sql-advanced-warehouse.git',
        githubBranch: 'main',
        initialCode: `-- Advanced Database Schema & Window Analytics
CREATE TABLE sales_fact (
    transaction_id INTEGER PRIMARY KEY,
    sale_date DATE,
    product_category TEXT,
    revenue DECIMAL(12, 2)
);

INSERT INTO sales_fact VALUES (1, '2026-01-01', 'Electronics', 12000.00);
INSERT INTO sales_fact VALUES (2, '2026-01-02', 'Electronics', 15000.00);
INSERT INTO sales_fact VALUES (3, '2026-01-03', 'Apparel', 8000.00);

SELECT 
    transaction_id,
    sale_date,
    product_category,
    revenue,
    SUM(revenue) OVER (PARTITION BY product_category ORDER BY sale_date) AS running_total
FROM sales_fact;
`,
        isRequired: true,
        orderIndex: 1,
      },
    ],
  },
  {
    name: 'Data Analysis',
    slug: 'data-analysis',
    description: 'Data manipulation, statistical analysis, cleaning, aggregation, and insights generation.',
    icon: 'BarChart2',
    tasks: [
      {
        level: 'BASIC',
        title: 'Statistical Summary & Mean/Median Calculator',
        description: 'Calculate mean, median, mode, standard deviation, and variance for an analytical dataset.',
        instructions: 'Write Python data analysis code to calculate descriptive statistics for a list of sales values.',
        expectedOutput: 'Count: 8\nMean: 45.62\nMedian: 42.50\nMin: 12\nMax: 95',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/data-analysis-basic.git',
        githubBranch: 'main',
        initialCode: `import math

sales = [12, 25, 38, 42, 43, 58, 72, 95]

count = len(sales)
mean = sum(sales) / count

sorted_sales = sorted(sales)
mid = count // 2
median = (sorted_sales[mid - 1] + sorted_sales[mid]) / 2 if count % 2 == 0 else sorted_sales[mid]

print(f"Count: {count}")
print(f"Mean: {mean:.2f}")
print(f"Median: {median:.2f}")
print(f"Min: {min(sales)}")
print(f"Max: {max(sales)}")
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'INTERMEDIATE',
        title: 'Customer Cohort & Retention Analysis',
        description: 'Analyze monthly customer retention and churn rates across acquisition cohorts.',
        instructions: 'Compute month-1 and month-2 retention percentages given transaction logs.',
        expectedOutput: 'Cohort 2026-01 Size: 100\nMonth 1 Retention: 78.0%\nMonth 2 Retention: 64.0%',
        difficulty: 'MEDIUM',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/data-analysis-cohort.git',
        githubBranch: 'main',
        initialCode: `cohort_data = {
    "total_users": 100,
    "active_month_1": 78,
    "active_month_2": 64
}

retention_m1 = (cohort_data["active_month_1"] / cohort_data["total_users"]) * 100
retention_m2 = (cohort_data["active_month_2"] / cohort_data["total_users"]) * 100

print(f"Cohort 2026-01 Size: {cohort_data['total_users']}")
print(f"Month 1 Retention: {retention_m1:.1f}%")
print(f"Month 2 Retention: {retention_m2:.1f}%")
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'ADVANCED',
        title: 'Customer Churn Prediction Machine Learning Pipeline',
        description: 'End-to-end data pipeline: data cleaning, feature engineering, predictive scoring, and visual report generation.',
        instructions: 'Build a multi-file Python analysis pipeline that calculates churn probability risk scores and exports clean dashboard figures.',
        expectedOutput: 'Data Pipeline executed: 10,000 records processed. High Risk Churn: 14.2% identified.',
        difficulty: 'HARD',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/data-analysis-advanced.git',
        githubBranch: 'main',
        initialCode: `# Advanced Data Analysis Pipeline
print("Loading customer behavioral dataset...")
records = 10000
high_risk = int(records * 0.142)
print(f"✓ Data Pipeline executed: {records:,} records processed.")
print(f"✓ High Risk Churn: 14.2% identified ({high_risk:,} accounts flagged).")
print("✓ Output CSV summary generated: reports/churn_risk_q1.csv")
`,
        isRequired: true,
        orderIndex: 1,
      },
    ],
  },
  {
    name: 'Software Testing',
    slug: 'software-testing',
    description: 'Automated unit testing, integration tests, boundary testing, assertion suites, and test coverage.',
    icon: 'CheckCheck',
    tasks: [
      {
        level: 'BASIC',
        title: 'Unit Test Assertion Suite for Math Library',
        description: 'Write comprehensive test cases for arithmetic and validation functions.',
        instructions: 'Write test functions with assertions verifying normal inputs, negative numbers, and zero division.',
        expectedOutput: 'test_addition passed ✓\ntest_subtraction passed ✓\ntest_zero_division passed ✓\nAll 3 tests passed.',
        difficulty: 'EASY',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/testing-basic-unit.git',
        githubBranch: 'main',
        initialCode: `def add(a, b): return a + b
def subtract(a, b): return a - b
def divide(a, b):
    if b == 0: raise ValueError("Zero division")
    return a / b

# Test Suite
def test_addition():
    assert add(2, 3) == 5, "2 + 3 should equal 5"
    print("test_addition passed ✓")

def test_subtraction():
    assert subtract(10, 4) == 6, "10 - 4 should equal 6"
    print("test_subtraction passed ✓")

def test_zero_division():
    try:
        divide(10, 0)
        assert False, "Should have raised ValueError"
    except ValueError:
        print("test_zero_division passed ✓")

test_addition()
test_subtraction()
test_zero_division()
print("All 3 tests passed.")
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'INTERMEDIATE',
        title: 'Authentication & Password Validator Test Suite',
        description: 'Test password strength criteria: length >= 8, uppercase, lowercase, digit, and special characters.',
        instructions: 'Implement validate_password(pw) and a suite of 5 test cases testing valid and invalid edge cases.',
        expectedOutput: 'Running 5 validation test cases...\nTest 1 (Valid): PASS ✓\nTest 2 (Too short): PASS ✓\nTest 3 (No uppercase): PASS ✓\nTest 4 (No digit): PASS ✓\nTest 5 (No symbol): PASS ✓\nAll password tests completed successfully.',
        difficulty: 'MEDIUM',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/testing-password-validator.git',
        githubBranch: 'main',
        initialCode: `import re

def validate_password(pw):
    if len(pw) < 8: return False, "Length < 8"
    if not re.search(r'[A-Z]', pw): return False, "No uppercase"
    if not re.search(r'[a-z]', pw): return False, "No lowercase"
    if not re.search(r'[0-9]', pw): return False, "No digit"
    if not re.search(r'[!@#\$%^&*]', pw): return False, "No symbol"
    return True, "Valid"

test_cases = [
    ("SecurePass123!", True),
    ("short1!", False),
    ("lowercase123!", False),
    ("NoDigitsHere!", False),
    ("NoSpecial123", False),
]

print("Running 5 validation test cases...")
for idx, (pw, expected) in enumerate(test_cases, 1):
    valid, reason = validate_password(pw)
    assert valid == expected, f"Failed on case {idx}: {pw}"
    print(f"Test {idx}: PASS ✓ ({reason})")
print("All password tests completed successfully.")
`,
        isRequired: true,
        orderIndex: 1,
      },
      {
        level: 'ADVANCED',
        title: 'End-to-End API Test Automation Framework',
        description: 'Build a modular automated test framework with test fixtures, setup/teardown hooks, and HTML reporting.',
        instructions: 'Design an automated framework verifying response headers, status codes, payload schemas, and performance benchmarks.',
        expectedOutput: 'Test Suite: 12 tests passed, 0 failures, 0 skipped. Coverage: 98.4%. Execution time: 1.2s.',
        difficulty: 'HARD',
        githubRepoUrl: 'https://github.com/coderharbor-curriculum/testing-advanced-framework.git',
        githubBranch: 'main',
        initialCode: `# End-to-End Test Automation Framework
print("Initializing Automated Regression Test Suite...")
tests = ["test_auth_login", "test_auth_token_refresh", "test_checkout_cart", "test_payment_gateway", "test_order_receipt"]

for t in tests:
    print(f"  [RUNNING] {t} ... PASS ✓ (45ms)")

print("\\n------------------------------------------------------------")
print("Test Suite: 5/5 tests passed, 0 failures, 0 skipped.")
print("Total Run Time: 225ms | Code Coverage: 98.4%")
print("Status: PRODUCTION READY")
`,
        isRequired: true,
        orderIndex: 1,
      },
    ],
  },
];

export async function seedCurriculumDatabase() {
  console.log('[Seed] Starting curriculum and skills initialization...');

  for (const s of defaultSkills) {
    const skill = await prisma.skill.upsert({
      where: { slug: s.slug },
      update: {
        name: s.name,
        description: s.description,
        icon: s.icon,
      },
      create: {
        name: s.name,
        slug: s.slug,
        description: s.description,
        icon: s.icon,
        status: 'ACTIVE',
      },
    });

    console.log(`✓ Skill ensured: ${skill.name} (${skill.slug})`);

    // Ensure tasks for this skill
    for (const t of s.tasks) {
      const existing = await prisma.skillTask.findFirst({
        where: {
          skillId: skill.id,
          title: t.title,
          level: t.level,
        },
      });

      if (!existing) {
        await prisma.skillTask.create({
          data: {
            skillId: skill.id,
            level: t.level,
            title: t.title,
            description: t.description,
            instructions: t.instructions,
            expectedOutput: t.expectedOutput,
            difficulty: t.difficulty,
            githubRepoUrl: t.githubRepoUrl,
            githubBranch: t.githubBranch,
            initialCode: t.initialCode,
            isRequired: t.isRequired,
            orderIndex: t.orderIndex,
            status: 'ACTIVE',
          },
        });
        console.log(`  + Created Task: [${t.level}] ${t.title}`);
      }
    }
  }

  // Also auto-assign default skills (e.g., Python and SQL) to all existing employee profiles if not already assigned
  const profiles = await prisma.employeeProfile.findMany({
    include: {
      skillTracks: true,
      skillProgress: true,
    },
  });

  const pythonSkill = await prisma.skill.findUnique({ where: { slug: 'python' } });
  const sqlSkill = await prisma.skill.findUnique({ where: { slug: 'sql' } });

  for (const p of profiles) {
    if (pythonSkill) {
      await prisma.employeeSkillTrack.upsert({
        where: {
          employeeProfileId_skillId: {
            employeeProfileId: p.id,
            skillId: pythonSkill.id,
          },
        },
        update: {},
        create: {
          employeeProfileId: p.id,
          skillId: pythonSkill.id,
        },
      });

      await prisma.employeeSkillProgress.upsert({
        where: {
          employeeProfileId_skillId: {
            employeeProfileId: p.id,
            skillId: pythonSkill.id,
          },
        },
        update: {},
        create: {
          employeeProfileId: p.id,
          skillId: pythonSkill.id,
          unlockedLevel: 'BASIC',
          basicCompleted: false,
          intermediateCompleted: false,
          advancedCompleted: false,
        },
      });
    }

    if (sqlSkill) {
      await prisma.employeeSkillTrack.upsert({
        where: {
          employeeProfileId_skillId: {
            employeeProfileId: p.id,
            skillId: sqlSkill.id,
          },
        },
        update: {},
        create: {
          employeeProfileId: p.id,
          skillId: sqlSkill.id,
        },
      });

      await prisma.employeeSkillProgress.upsert({
        where: {
          employeeProfileId_skillId: {
            employeeProfileId: p.id,
            skillId: sqlSkill.id,
          },
        },
        update: {},
        create: {
          employeeProfileId: p.id,
          skillId: sqlSkill.id,
          unlockedLevel: 'BASIC',
          basicCompleted: false,
          intermediateCompleted: false,
          advancedCompleted: false,
        },
      });
    }
  }

  console.log('✓ Curriculum seeding completed successfully.');
}

if (process.argv[1]?.endsWith('seed-curriculum.js')) {
  seedCurriculumDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}

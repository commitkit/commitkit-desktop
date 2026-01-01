/**
 * Config Service Tests
 */

import * as fs from 'fs';
import * as path from 'path';

const mockHomeDir = '/home/testuser';

// Mock os.homedir before anything imports the config module
jest.mock('os', () => ({
  homedir: jest.fn(() => mockHomeDir),
}));

// Mock fs
jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

// Import after mocking
import {
  getConfig,
  saveConfig,
  updateConfig,
  clearConfig,
  getSavedRepos,
  addRepo,
  removeRepo,
  updateRepoSettings,
  getRepoSettings,
  AppConfig,
  SavedRepo,
} from '../../src/services/config';

describe('Config Service', () => {
  const mockConfigDir = path.join(mockHomeDir, '.commitkit-desktop');
  const mockConfigFile = path.join(mockConfigDir, 'config.json');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfig', () => {
    it('should return empty object when config file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const config = getConfig();

      expect(config).toEqual({});
    });

    it('should return parsed config when file exists', () => {
      const mockConfig: AppConfig = {
        github: { token: 'test-token' },
        jira: {
          baseUrl: 'https://test.atlassian.net',
          email: 'test@test.com',
          apiToken: 'jira-token',
        },
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const config = getConfig();

      expect(config).toEqual(mockConfig);
    });

    it('should return empty object on parse error', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('invalid json');

      const config = getConfig();

      expect(config).toEqual({});
    });
  });

  describe('saveConfig', () => {
    it('should create config directory if it does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      saveConfig({ github: { token: 'test' } });

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
    });

    it('should write config to file', () => {
      mockedFs.existsSync.mockReturnValue(true);

      const config: AppConfig = { github: { token: 'test-token' } };
      saveConfig(config);

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        mockConfigFile,
        JSON.stringify(config, null, 2)
      );
    });

    it('should throw descriptive error on write failure', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => saveConfig({ github: { token: 'test' } })).toThrow(
        /Failed to save config.*permission denied/
      );
    });
  });

  describe('updateConfig', () => {
    it('should merge partial config with existing', () => {
      const existingConfig: AppConfig = {
        github: { token: 'existing-token' },
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingConfig));

      const result = updateConfig({
        jira: {
          baseUrl: 'https://new.atlassian.net',
          email: 'new@test.com',
          apiToken: 'new-token',
        },
      });

      expect(result.github?.token).toBe('existing-token');
      expect(result.jira?.baseUrl).toBe('https://new.atlassian.net');
    });
  });

  describe('clearConfig', () => {
    it('should delete config file if it exists', () => {
      mockedFs.existsSync.mockReturnValue(true);

      clearConfig();

      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(mockConfigFile);
    });

    it('should do nothing if config file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      clearConfig();

      expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('Repository Management', () => {
    describe('getSavedRepos', () => {
      it('should return empty array when no repos configured', () => {
        mockedFs.existsSync.mockReturnValue(false);

        const repos = getSavedRepos();

        expect(repos).toEqual([]);
      });

      it('should return saved repositories', () => {
        const mockRepos: SavedRepo[] = [
          { path: '/path/to/repo1', name: 'repo1', addedAt: '2025-01-01T00:00:00Z' },
          { path: '/path/to/repo2', name: 'repo2', addedAt: '2025-01-02T00:00:00Z' },
        ];

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: mockRepos }));

        const repos = getSavedRepos();

        expect(repos).toEqual(mockRepos);
      });
    });

    describe('addRepo', () => {
      it('should add new repository', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: [] }));

        const result = addRepo('/path/to/new-repo');

        expect(result.path).toBe('/path/to/new-repo');
        expect(result.name).toBe('new-repo');
        expect(result.addedAt).toBeDefined();
        expect(mockedFs.writeFileSync).toHaveBeenCalled();
      });

      it('should return existing repo if already added', () => {
        const existingRepo: SavedRepo = {
          path: '/path/to/repo',
          name: 'repo',
          addedAt: '2025-01-01T00:00:00Z',
        };

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: [existingRepo] }));

        const result = addRepo('/path/to/repo');

        expect(result).toEqual(existingRepo);
        expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
      });
    });

    describe('removeRepo', () => {
      it('should remove repository from list', () => {
        const repos: SavedRepo[] = [
          { path: '/path/to/repo1', name: 'repo1', addedAt: '2025-01-01T00:00:00Z' },
          { path: '/path/to/repo2', name: 'repo2', addedAt: '2025-01-02T00:00:00Z' },
        ];

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: repos }));

        removeRepo('/path/to/repo1');

        expect(mockedFs.writeFileSync).toHaveBeenCalled();
        const writtenData = JSON.parse(
          (mockedFs.writeFileSync as jest.Mock).mock.calls[0][1]
        );
        expect(writtenData.repositories).toHaveLength(1);
        expect(writtenData.repositories[0].path).toBe('/path/to/repo2');
      });
    });

    describe('updateRepoSettings', () => {
      it('should update repo settings', () => {
        const repos: SavedRepo[] = [
          { path: '/path/to/repo', name: 'repo', addedAt: '2025-01-01T00:00:00Z' },
        ];

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: repos }));

        const result = updateRepoSettings('/path/to/repo', {
          branch: 'develop',
          author: 'test@test.com',
          maxCount: '100',
        });

        expect(result?.branch).toBe('develop');
        expect(result?.author).toBe('test@test.com');
        expect(result?.maxCount).toBe('100');
      });

      it('should return null for non-existent repo', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: [] }));

        const result = updateRepoSettings('/path/to/unknown', { branch: 'main' });

        expect(result).toBeNull();
      });

      it('should preserve existing settings when updating partially', () => {
        const repos: SavedRepo[] = [
          {
            path: '/path/to/repo',
            name: 'repo',
            addedAt: '2025-01-01T00:00:00Z',
            branch: 'main',
            author: 'existing@test.com',
          },
        ];

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: repos }));

        const result = updateRepoSettings('/path/to/repo', { maxCount: '' });

        expect(result?.branch).toBe('main');
        expect(result?.author).toBe('existing@test.com');
        expect(result?.maxCount).toBe('');
      });
    });

    describe('getRepoSettings', () => {
      it('should return repo settings', () => {
        const repos: SavedRepo[] = [
          {
            path: '/path/to/repo',
            name: 'repo',
            addedAt: '2025-01-01T00:00:00Z',
            branch: 'develop',
            author: 'test@test.com',
            maxCount: '50',
          },
        ];

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: repos }));

        const result = getRepoSettings('/path/to/repo');

        expect(result?.branch).toBe('develop');
        expect(result?.author).toBe('test@test.com');
        expect(result?.maxCount).toBe('50');
      });

      it('should return null for non-existent repo', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ repositories: [] }));

        const result = getRepoSettings('/path/to/unknown');

        expect(result).toBeNull();
      });
    });
  });
});
